// TCB — Verified-subset checker (trusted).
//
// Enforces the syntactic fragment defined in DESIGN.md for src/verified/**.
// Tier rule: domain/ is strictly pure (no async/await/Promise); contracts/ and
// usecases/ may additionally use async/await/Promise types for the Port, but
// nothing else from the ban list. Anything outside the fragment => failure.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const VERIFIED = path.join(REPO, "src", "verified");

const BANNED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "require",
  "process",
  "globalThis",
  "fetch",
  "console",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "Math",
  "Date",
  "undefined",
  "Promise",
  "URL",
  "Deno",
  "Bun",
]);

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

function checkFile(file) {
  const errors = [];
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const rel = path.relative(REPO, file);
  const tier2 = rel.includes(`${path.sep}usecases${path.sep}`) || rel.includes(`${path.sep}contracts${path.sep}`);
  const err = (node, msg) => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    errors.push(`${rel}:${pos.line + 1}:${pos.character + 1}: ${msg}`);
  };

  const isDeclarationName = (node, parent) => {
    if (!parent) return false;
    return (
      ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isMethodDeclaration(parent)) &&
        parent.name === node) ||
      ((ts.isParameter(parent) || ts.isVariableDeclaration(parent) || ts.isPropertySignature(parent) ||
        ts.isPropertyDeclaration(parent) || ts.isEnumMember(parent) || ts.isTypeParameterDeclaration(parent)) &&
        parent.name === node)
    );
  };

  const visit = (node, parent) => {
    // Identifiers in value positions must not be banned globals.
    if (ts.isIdentifier(node)) {
      if (!isDeclarationName(node, parent) && BANNED_IDENTIFIERS.has(node.text)) {
        // Allow `Promise` only as a type name inside tier 2 (handled at TypeReference).
        err(node, `banned identifier '${node.text}' in Verified Code`);
      }
      return;
    }
    if (
      node.kind === ts.SyntaxKind.AnyKeyword ||
      node.kind === ts.SyntaxKind.UnknownKeyword
    ) {
      err(node, "banned type 'any'/'unknown' in Verified Code");
      return;
    }
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression?.(node) ||
      node.kind === ts.SyntaxKind.NonNullExpression ||
      node.kind === ts.SyntaxKind.TypeAssertionExpression
    ) {
      err(node, "banned cast/non-null assertion in Verified Code");
      return;
    }
    if (
      ts.isThrowStatement(node) ||
      ts.isTryStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isWithStatement(node) ||
      node.kind === ts.SyntaxKind.DebuggerStatement ||
      ts.isDeleteExpression(node)
    ) {
      err(node, `banned statement/expression '${ts.SyntaxKind[node.kind]}' in Verified Code`);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isEnumDeclaration(node)) {
      err(node, "banned class/enum in Verified Code");
      return;
    }
    if (ts.isNewExpression(node)) {
      err(node, "banned 'new' in Verified Code (no construction of impure objects)");
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      err(node, "banned closure in Verified Code (top-level pure functions only)");
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      err(node, "banned dynamic property access a[b] in Verified Code");
      return;
    }
    if (ts.isTemplateExpression(node)) {
      err(node, "banned interpolated template string in Verified Code");
      return;
    }
    if (node.kind === ts.SyntaxKind.ShorthandPropertyAssignment || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      err(node, "banned shorthand/getter/setter in Verified Code");
      return;
    }
    if (node.questionDotToken) {
      err(node, "banned optional chaining '?.' in Verified Code");
      return;
    }
    if (node.questionToken && (ts.isParameter(node) || ts.isPropertySignature(node))) {
      err(node, "banned optional '?' in Verified Code");
      return;
    }
    if (node.exclamationToken && (ts.isVariableDeclaration(node) || ts.isPropertySignature(node))) {
      err(node, "banned definite-assignment '!' in Verified Code");
      return;
    }
    if (ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) {
      const flags = ts.isVariableStatement(node) ? node.declarationList.flags : node.flags;
      if ((flags & ts.NodeFlags.Const) === 0) {
        err(node, "banned let/var in Verified Code (const only)");
      }
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
      if (!tier2) err(node, "banned await/yield outside usecases/contracts");
      return;
    }
    if (node.kind === ts.SyntaxKind.AsyncKeyword) {
      if (!tier2) err(node, "banned async outside usecases/contracts");
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(sf);
      if (name === "Promise" && !tier2) err(node, "banned Promise type outside usecases/contracts");
      return; // do not descend into type names (avoids false identifier hits)
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        err(node, "banned dynamic import() in Verified Code");
        return;
      }
      // recursion check: direct self-call
      let fn = parent;
      while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
      if (fn?.name && ts.isIdentifier(node.expression) && node.expression.text === fn.name.text) {
        err(node, `banned recursion in Verified Code (${fn.name.text} calls itself)`);
      }
    }
    if (ts.isDecorator?.(node)) {
      err(node, "banned decorator in Verified Code");
      return;
    }
    ts.forEachChild(node, (c) => visit(c, node));
  };

  // Seed parent pointers for the recursion check.
  const setParents = (node, parent) => {
    node.parent = parent;
    ts.forEachChild(node, (c) => setParents(c, node));
  };
  setParents(sf, null);
  ts.forEachChild(sf, (c) => visit(c, sf));
  return errors;
}

function main() {
  const target = process.argv[2] ?? VERIFIED;
  const files = listFiles(target);
  if (files.length === 0) {
    console.log("✗ no Verified files found");
    process.exit(1);
  }
  let errors = [];
  for (const f of files) errors.push(...checkFile(f));
  if (errors.length > 0) {
    console.log("✗ Verified subset violations:");
    for (const e of errors) console.log(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ Verified subset (${files.length} files, fragment enforced)`);
}

main();
