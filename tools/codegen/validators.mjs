// TCB — validator generator (trusted, run rarely; output is machine-checked).
//
// Derives zod input schemas from Requires predicates so the correspondence
// "validator bounds == domain predicates" holds BY CONSTRUCTION instead of by
// human inspection. Only length bounds on string fields of *Input types are
// generatable; anything else in such a Requires is a hard error (fail-closed).
// Requires over entity types (e.g. Todo) guard DB-loaded values, not HTTP
// bodies, so they produce no schema (reported explicitly, not silently).
//
// Usage:
//   node tools/codegen/validators.mjs          # write generated files
//   node tools/codegen/validators.mjs --check  # fail if committed files drift
// `--check` runs inside `npm run verify`.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SPEC = path.join(REPO, "src", "verified", "specs", "todo.ts");
const OUT_DIR = path.join(REPO, "src", "tcb", "validation", "generated");

class CodegenError extends Error {}

function parseSpec() {
  const text = fs.readFileSync(SPEC, "utf8");
  const sf = ts.createSourceFile("todo.ts", text, ts.ScriptTarget.ES2022, true);
  const interfaces = new Map();
  const requires = new Map(); // baseName -> { paramName, inputType, body }
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const fields = new Map();
      for (const m of stmt.members) {
        if (ts.isPropertySignature(m) && ts.isIdentifier(m.name)) {
          const k = m.type?.kind;
          fields.set(
            m.name.text,
            k === ts.SyntaxKind.StringKeyword
              ? "string"
              : k === ts.SyntaxKind.BooleanKeyword
                ? "boolean"
                : k === ts.SyntaxKind.NumberKeyword
                  ? "number"
                  : "other",
          );
        }
      }
      interfaces.set(stmt.name.text, fields);
    } else if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      stmt.body &&
      stmt.name.text.endsWith("Requires")
    ) {
      const base = stmt.name.text.slice(0, -"Requires".length);
      const params = stmt.parameters ?? [];
      if (params.length !== 1 || !ts.isIdentifier(params[0].name) || !params[0].type) {
        throw new CodegenError(`${stmt.name.text}: expected (input: SomeType)`);
      }
      const ret = stmt.body.statements.find((s) => ts.isReturnStatement(s))?.expression;
      if (!ret) throw new CodegenError(`${stmt.name.text}: missing return`);
      requires.set(base, {
        paramName: params[0].name.text,
        inputType: params[0].type.getText(sf),
        body: ret,
      });
    }
  }
  return { interfaces, requires };
}

// Collect {field -> {min?, max?}} from a conjunction of `X.f.length >=|<= N`.
// Any other conjunct is a hard error (fail-closed: no silent weakening).
function collectBounds(node, paramName, out) {
  if (ts.isParenthesizedExpression(node)) {
    collectBounds(node.expression, paramName, out);
    return;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    collectBounds(node.left, paramName, out);
    collectBounds(node.right, paramName, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const isGe = op === ts.SyntaxKind.GreaterThanEqualsToken;
    const isLe = op === ts.SyntaxKind.LessThanEqualsToken;
    if (
      (isGe || isLe) &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "length" &&
      ts.isPropertyAccessExpression(node.left.expression) &&
      ts.isIdentifier(node.left.expression.expression) &&
      node.left.expression.expression.text === paramName &&
      ts.isIdentifier(node.left.expression.name) &&
      ts.isNumericLiteral(node.right) &&
      Number.isInteger(Number(node.right.text))
    ) {
      const field = node.left.expression.name.text;
      const n = Number(node.right.text);
      const e = out.get(field) ?? {};
      if (isGe) {
        if (e.min !== undefined) throw new CodegenError(`duplicate min bound for ${field}`);
        e.min = n;
      } else {
        if (e.max !== undefined) throw new CodegenError(`duplicate max bound for ${field}`);
        e.max = n;
      }
      out.set(field, e);
      return;
    }
  }
  throw new CodegenError(
    `non-length predicate in body-guard Requires (not generatable): ${node.getText()}`,
  );
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generate() {
  const { interfaces, requires } = parseSpec();
  const files = new Map(); // relpath -> content
  for (const [base, spec] of requires) {
    // Only *Input types guard client-supplied bodies.
    if (!spec.inputType.endsWith("Input")) {
      console.log(`(skip) ${base}Requires guards ${spec.inputType}, not a client body`);
      continue;
    }
    const iface = interfaces.get(spec.inputType);
    if (!iface) throw new CodegenError(`unknown input type ${spec.inputType}`);
    const bounds = new Map();
    collectBounds(spec.body, spec.paramName, bounds);
    if (bounds.size === 0) throw new CodegenError(`${base}Requires: no bounds found`);
    const lines = [];
    for (const [field, b] of bounds) {
      if (iface.get(field) !== "string") {
        throw new CodegenError(`${base}Requires: length bound on non-string field ${field}`);
      }
      let chain = "z.string()";
      if (b.min !== undefined) chain += `.min(${b.min})`;
      if (b.max !== undefined) chain += `.max(${b.max})`;
      lines.push(`    ${field}: ${chain},`);
    }
    const name = `${cap(base)}Body`;
    const content = `// GENERATED from src/verified/specs/todo.ts (${base}Requires) — do not edit by hand.\n// Regenerate: node tools/codegen/validators.mjs (freshness enforced by \`npm run verify\`).\nimport { z } from "zod";\n\nexport const ${name} = z.object({\n${lines.join("\n")}\n});\nexport type ${name} = z.infer<typeof ${name}>;\n`;
    files.set(`src/tcb/validation/generated/${base}Body.ts`, content);
  }
  return files;
}

function main() {
  const check = process.argv.includes("--check");
  const files = generate();
  if (files.size === 0) throw new CodegenError("no schemas generated");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let drift = [];
  for (const [rel, content] of files) {
    const abs = path.join(REPO, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (check) {
      if (current !== content) drift.push(rel);
    } else {
      fs.writeFileSync(abs, content);
      console.log(`wrote ${rel}`);
    }
  }
  if (check) {
    if (drift.length > 0) {
      console.log(`✗ generated validators drifted (run node tools/codegen/validators.mjs):`);
      for (const d of drift) console.log(`  ${d}`);
      process.exit(1);
    }
    console.log(`✓ generated validators fresh (${files.size} file(s))`);
  }
}

main();
