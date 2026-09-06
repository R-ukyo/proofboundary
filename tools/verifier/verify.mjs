// TCB — SMT contract prover (part of the trusted verifier).
//
// What it does (genuinely, not theater):
//  1. Parses the ACTUAL Verified source file with the TypeScript compiler API.
//  2. Translates the impl + Requires/Ensures function bodies to Z3 terms
//     (Bool + String + Int-for-lengths). Any AST node outside the supported
//     fragment is a hard ERROR (fail-closed): unmodelable code can never
//     silently "pass".
//  3. Asks Z3 about  Pre(input) ∧ output=Impl(input) ∧ ¬Post(input, output).
//     unsat = contract proved for ALL inputs. sat = prints the model as a
//     counterexample (input values + produced output values).
//
// Trusted (NOT proved): this file itself, tsc parsing, z3-solver answers.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const z3pkg = require("z3-solver");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const TARGETS = [
  { impl: "createTodo", pre: "createTodoRequires", post: "createTodoEnsures" },
  { impl: "completeTodo", pre: "completeTodoRequires", post: "completeTodoEnsures" },
  { impl: "reopenTodo", pre: "reopenTodoRequires", post: "reopenTodoEnsures" },
];

class VerifyError extends Error {}

// ---------------------------------------------------------------- parsing

function parseModule(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(path.basename(filePath), text, ts.ScriptTarget.ES2022, true);
  const interfaces = new Map(); // name -> Map(field -> 'string'|'boolean'|'number')
  const functions = new Map(); // name -> { params: [{name,type}], consts: [{name,init}], ret }
  const constLits = new Map(); // top-level const name -> literal value

  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const fields = new Map();
      for (const m of stmt.members) {
        if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) {
          throw new VerifyError(`unsupported interface member in ${stmt.name.text}`);
        }
        const k = m.type?.kind;
        if (k === ts.SyntaxKind.StringKeyword) fields.set(m.name.text, "string");
        else if (k === ts.SyntaxKind.BooleanKeyword) fields.set(m.name.text, "boolean");
        else if (k === ts.SyntaxKind.NumberKeyword) fields.set(m.name.text, "number");
        else throw new VerifyError(`unsupported field type for ${stmt.name.text}.${m.name.text}`);
      }
      interfaces.set(stmt.name.text, fields);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      const params = (stmt.parameters ?? []).map((p) => {
        if (!ts.isIdentifier(p.name) || !p.type) {
          throw new VerifyError(`function ${stmt.name.text}: params need typed identifiers`);
        }
        return { name: p.name.text, type: p.type.getText(sf) };
      });
      const consts = [];
      let ret = null;
      for (const s of stmt.body.statements) {
        if (ts.isVariableStatement(s)) {
          if ((s.declarationList.flags & ts.NodeFlags.Const) === 0) {
            throw new VerifyError(`function ${stmt.name.text}: only const bindings allowed`);
          }
          for (const d of s.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer) {
              throw new VerifyError(`function ${stmt.name.text}: bad const binding`);
            }
            consts.push({ name: d.name.text, init: d.initializer });
          }
        } else if (ts.isReturnStatement(s)) {
          if (ret !== null || !s.expression) {
            throw new VerifyError(`function ${stmt.name.text}: single return required`);
          }
          ret = s.expression;
        } else {
          throw new VerifyError(
            `function ${stmt.name.text}: unsupported statement ${ts.SyntaxKind[s.kind]}`,
          );
        }
      }
      if (ret === null) throw new VerifyError(`function ${stmt.name.text}: missing return`);
      functions.set(stmt.name.text, { params, consts, ret, source: stmt.name.text });
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          const v = foldLiteral(d.initializer);
          if (v === undefined) throw new VerifyError(`unsupported top-level const ${d.name.text}`);
          constLits.set(d.name.text, v);
        }
      }
    } else if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      // imports/exports carry no semantics for the proof; boundary is checked elsewhere
    } else if (ts.isTypeAliasDeclaration(stmt) || ts.isEndOfFileToken(stmt)) {
      // ignored
    } else {
      throw new VerifyError(`unsupported top-level ${ts.SyntaxKind[stmt.kind]}`);
    }
  }
  return { interfaces, functions, constLits };
}

function foldLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { sort: "string", value: node.text };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { sort: "boolean", value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { sort: "boolean", value: false };
  if (ts.isNumericLiteral(node)) {
    const n = Number(node.text);
    if (!Number.isInteger(n)) throw new VerifyError("only integer literals supported");
    return { sort: "int", value: n };
  }
  return undefined;
}

// ------------------------------------------------------- expression -> Z3

function makeTranslator(ctx, mod, constLits, tag) {
  const { Bool, Int, String, And, Or, Not, Eq, If } = ctx;

  function andAll(terms) {
    if (terms.length === 0) return Bool.val(true);
    let acc = terms[0];
    for (let i = 1; i < terms.length; i++) acc = And(acc, terms[i]);
    return acc;
  }
  function orAll(terms) {
    if (terms.length === 0) return Bool.val(false);
    let acc = terms[0];
    for (let i = 1; i < terms.length; i++) acc = Or(acc, terms[i]);
    return acc;
  }

  // env: { scalars: Map(name -> {sort,term}), objects: Map(name -> {type,fields:Map}) }
  function ev(node, env) {
    if (ts.isParenthesizedExpression(node)) return ev(node.expression, env);
    const lit = foldLiteral(node);
    if (lit !== undefined) {
      if (lit.sort === "string") return { kind: "string", term: String.val(lit.value) };
      if (lit.sort === "boolean") return { kind: "boolean", term: Bool.val(lit.value) };
      return { kind: "int", term: Int.val(lit.value) };
    }
    if (ts.isIdentifier(node)) {
      if (env.scalars.has(node.text)) {
        const s = env.scalars.get(node.text);
        return { kind: s.sort, term: s.term };
      }
      if (env.objects.has(node.text)) {
        const o = env.objects.get(node.text);
        return { kind: "obj", type: o.type, fields: o.fields };
      }
      if (constLits.has(node.text)) {
        const l = constLits.get(node.text);
        if (l.sort === "string") return { kind: "string", term: String.val(l.value) };
        if (l.sort === "boolean") return { kind: "boolean", term: Bool.val(l.value) };
        return { kind: "int", term: Int.val(l.value) };
      }
      throw new VerifyError(`unknown identifier ${node.text}`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "length") {
        const base = ev(node.expression, env);
        if (base.kind !== "string") throw new VerifyError(".length on non-string");
        return { kind: "int", term: base.term.length() };
      }
      const base = ev(node.expression, env);
      if (base.kind !== "obj") throw new VerifyError(`.${node.name.text} on non-object`);
      const f = base.fields.get(node.name.text);
      if (!f) throw new VerifyError(`unknown field ${node.name.text}`);
      return { kind: f.sort, term: f.term };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const fields = new Map();
      for (const p of node.properties) {
        if (ts.isSpreadAssignment(p)) {
          const v = ev(p.expression, env);
          if (v.kind !== "obj") throw new VerifyError("spread of non-object");
          for (const [k, f] of v.fields) fields.set(k, f);
        } else if (ts.isPropertyAssignment(p)) {
          const key = ts.isIdentifier(p.name)
            ? p.name.text
            : ts.isStringLiteral(p.name)
              ? p.name.text
              : null;
          if (key === null) throw new VerifyError("unsupported property name");
          const v = ev(p.initializer, env);
          if (v.kind === "obj") throw new VerifyError("nested objects unsupported");
          fields.set(key, { sort: v.kind, term: v.term });
        } else {
          throw new VerifyError("unsupported object property");
        }
      }
      return { kind: "obj", type: null, fields };
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const v = ev(node.operand, env);
      if (v.kind !== "boolean") throw new VerifyError("! on non-boolean");
      return { kind: "boolean", term: Not(v.term) };
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const l = ev(node.left, env);
      const r = ev(node.right, env);
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (l.kind !== "boolean" || r.kind !== "boolean") throw new VerifyError("&& on non-boolean");
        return { kind: "boolean", term: And(l.term, r.term) };
      }
      if (op === ts.SyntaxKind.BarBarToken) {
        if (l.kind !== "boolean" || r.kind !== "boolean") throw new VerifyError("|| on non-boolean");
        return { kind: "boolean", term: Or(l.term, r.term) };
      }
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        if (l.kind === "obj" || r.kind === "obj" || l.kind !== r.kind) {
          throw new VerifyError("=== between incompatible sorts");
        }
        const eq = Eq(l.term, r.term);
        return { kind: "boolean", term: op === ts.SyntaxKind.EqualsEqualsEqualsToken ? eq : Not(eq) };
      }
      if (
        op === ts.SyntaxKind.GreaterThanEqualsToken ||
        op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken ||
        op === ts.SyntaxKind.LessThanToken
      ) {
        if (l.kind !== "int" || r.kind !== "int") throw new VerifyError("comparison on non-int");
        if (op === ts.SyntaxKind.GreaterThanEqualsToken) return { kind: "boolean", term: l.term.ge(r.term) };
        if (op === ts.SyntaxKind.LessThanEqualsToken) return { kind: "boolean", term: l.term.le(r.term) };
        if (op === ts.SyntaxKind.GreaterThanToken) return { kind: "boolean", term: l.term.gt(r.term) };
        return { kind: "boolean", term: l.term.lt(r.term) };
      }
      if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken) {
        if (l.kind !== "int" || r.kind !== "int") throw new VerifyError("arithmetic on non-int");
        return { kind: "int", term: op === ts.SyntaxKind.PlusToken ? l.term.add(r.term) : l.term.sub(r.term) };
      }
      throw new VerifyError(`unsupported operator ${ts.SyntaxKind[op]}`);
    }
    if (ts.isConditionalExpression(node)) {
      const c = ev(node.condition, env);
      const a = ev(node.whenTrue, env);
      const b = ev(node.whenFalse, env);
      if (c.kind !== "boolean" || a.kind !== b.kind || a.kind === "obj") {
        throw new VerifyError("unsupported ternary");
      }
      return { kind: a.kind, term: If(c.term, a.term, b.term) };
    }
    throw new VerifyError(`unsupported expression ${ts.SyntaxKind[node.kind]}`);
  }

  return { ev, andAll, orAll };
}

// ------------------------------------------------------------------ proof

async function proveFile(ctx, filePath, tag) {
  const mod = parseModule(filePath);
  const results = [];
  for (const t of TARGETS) {
    results.push(await proveTarget(ctx, mod, filePath, tag, t));
  }
  return results;
}

async function proveTarget(ctx, mod, filePath, tag, t) {
  const { Solver, Bool, Int, String, Not } = ctx;
  const impl = mod.functions.get(t.impl);
  const pre = mod.functions.get(t.pre);
  const post = mod.functions.get(t.post);
  if (!impl) throw new VerifyError(`${filePath}: missing function ${t.impl}`);
  if (!pre) throw new VerifyError(`${filePath}: missing function ${t.pre}`);
  if (!post) throw new VerifyError(`${filePath}: missing function ${t.post}`);
  if (pre.params.length !== 1) throw new VerifyError(`${t.pre} must take exactly 1 param`);
  if (post.params.length !== 2) throw new VerifyError(`${t.post} must take exactly 2 params`);

  const inType = pre.params[0].type;
  const iface = mod.interfaces.get(inType);
  if (!iface) throw new VerifyError(`${t.pre}: unknown input type ${inType}`);

  const tr = makeTranslator(ctx, mod, mod.constLits, tag);
  const mkSym = (prefix, field, sort) => {
    const name = `${tag}__${prefix}__${field}`;
    if (sort === "string") return { sort, term: String.const(name) };
    if (sort === "boolean") return { sort, term: Bool.const(name) };
    return { sort, term: Int.const(name) };
  };

  // One symbolic input object, aliased under every name the three functions use.
  const inputFields = new Map();
  for (const [f, s] of iface) inputFields.set(f, mkSym("in", f, s));
  const inputObj = { type: inType, fields: inputFields };

  const outParamName = post.params[1].name;
  const makeEnv = (fn, unbound = null) => {
    const env = { scalars: new Map(), objects: new Map() };
    for (const p of fn.params) {
      if (p.name === unbound) continue; // bound later (post's output = impl result)
      if (mod.interfaces.has(p.type)) {
        // All interface-typed params alias the SAME symbolic input object.
        env.objects.set(p.name, inputObj);
      } else if (p.type === "string") env.scalars.set(p.name, { sort: "string", term: String.const(`${tag}__${p.name}`) });
      else if (p.type === "boolean") env.scalars.set(p.name, { sort: "boolean", term: Bool.const(`${tag}__${p.name}`) });
      else if (p.type === "number") env.scalars.set(p.name, { sort: "int", term: Int.const(`${tag}__${p.name}`) });
      else throw new VerifyError(`${fn.source}: unsupported param type ${p.type}`);
    }
    for (const c of fn.consts) {
      const v = tr.ev(c.init, env);
      if (v.kind === "obj") env.objects.set(c.name, { type: v.type, fields: v.fields });
      else env.scalars.set(c.name, { sort: v.kind, term: v.term });
    }
    return env;
  };
  const preEnv = makeEnv(pre);
  const preR = tr.ev(pre.ret, preEnv);
  if (preR.kind !== "boolean") throw new VerifyError(`${t.pre} must return boolean`);
  const implEnv = makeEnv(impl);
  const implR = tr.ev(impl.ret, implEnv);
  if (implR.kind !== "obj") throw new VerifyError(`${t.impl} must return an object`);
  const postEnv = makeEnv(post, outParamName);
  // Bind post's output param to the implementation result.
  const outParam = post.params[1].name;
  postEnv.objects.set(outParam, { type: null, fields: implR.fields });
  const postR = tr.ev(post.ret, postEnv);
  if (postR.kind !== "boolean") throw new VerifyError(`${t.post} must return boolean`);

  const solver = new Solver();
  solver.add(preR.term);
  solver.add(Not(postR.term));
  const verdict = await solver.check();
  if (verdict === "unsat") {
    return { name: t.impl, proved: true };
  }
  if (verdict === "sat") {
    const model = solver.model();
    const show = (tm) => model.eval(tm, true).toString();
    const lines = [];
    for (const [f, s] of inputFields) lines.push(`  input.${f} = ${show(s.term)}`);
    for (const [f, s] of implR.fields) lines.push(`  output.${f} = ${show(s.term)}`);
    return { name: t.impl, proved: false, counterexample: lines };
  }
  throw new VerifyError(`${t.impl}: solver returned ${verdict}`);
}

// ------------------------------------------------------------------ main

async function main() {
  const mode = process.argv[2] ?? "all";
  const api = await z3pkg.init();
  const ctx = new (api.Context)("main");

  let failed = 0;
  const realFile = path.join(REPO, "src", "verified", "domain", "todo.ts");
  try {
    const results = await proveFile(ctx, realFile, "real");
    for (const r of results) {
      if (r.proved) {
        console.log(`✓ ${r.name} proof (UNSAT: contract holds for all inputs)`);
      } else {
        failed++;
        console.log(`✗ ${r.name} proof FAILED`);
        console.log(`Cannot prove postcondition. Counterexample:`);
        for (const l of r.counterexample ?? []) console.log(l);
      }
    }
  } catch (e) {
    failed++;
    console.log(`✗ prover error on verified code: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (mode === "all" || mode === "mutations") {
    const dir = path.join(REPO, "fixtures", "invalid");
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
    } catch {
      entries = [];
    }
    if (entries.length === 0) {
      failed++;
      console.log("✗ no invalid fixtures found (negative control missing)");
    }
    for (const f of entries) {
      const fp = path.join(dir, f);
      try {
        const results = await proveFile(ctx, fp, `mut_${f.replace(/[^A-Za-z0-9]/g, "_")}`);
        const refuted = results.filter((r) => !r.proved);
        if (refuted.length === 0) {
          failed++;
          console.log(`✗ mutation ${f}: PROVED (prover failed to reject known-bad code!)`);
        } else {
          console.log(
            `✓ mutation ${f}: correctly rejected (${refuted.map((r) => r.name).join(", ")})`,
          );
          for (const r of refuted) {
            for (const l of r.counterexample ?? []) console.log(`    ${l.trim()}`);
          }
        }
      } catch (e) {
        // Fail-closed translation errors also count as "rejected", but say so explicitly.
        console.log(`✓ mutation ${f}: correctly rejected (translator error: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`verifier crashed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(2);
});
