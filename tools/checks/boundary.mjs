// TCB — import/global boundary checker (trusted).
//
// Decides mechanically which file is Verified and which is TCB, then enforces:
//  - src/verified/** may import ONLY via relative paths staying inside
//    src/verified/** (no bare specifiers: no pg/zod/hono/express/node:*, ...).
//  - src/verified/** must not reference capability globals (fetch, process,
//    ...). A file that merely CLAIMS to be Verified but touches the outside
//    world fails the build here.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const VERIFIED = path.join(REPO, "src", "verified");

const BANNED_BARE_PREFIXES = [
  "pg",
  "zod",
  "hono",
  "express",
  "fastify",
  "@prisma",
  "drizzle",
  "node:",
  "fs",
  "fetch",
];

const BANNED_GLOBALS = new Set([
  "fetch",
  "process",
  "Deno",
  "Bun",
  "globalThis",
  "window",
  "localStorage",
  "XMLHttpRequest",
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

function checkFile(file, root) {
  const errors = [];
  const rel = path.relative(REPO, file);
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const err = (node, msg) => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    errors.push(`${rel}:${pos.line + 1}:${pos.character + 1}: ${msg}`);
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        const target = spec.text;
        if (!target.startsWith(".")) {
          err(spec, `TCB boundary violation: bare import '${target}' forbidden in src/verified/**`);
        } else {
          const resolved = path.normalize(path.join(path.dirname(file), target));
          const withTs = resolved.endsWith(".js") ? resolved.slice(0, -3) + ".ts" : resolved;
          const inside =
            withTs === root || withTs.startsWith(root + path.sep) || resolved.startsWith(root + path.sep);
          if (!inside) {
            err(spec, `TCB boundary violation: import '${target}' escapes src/verified/**`);
          }
        }
        for (const prefix of BANNED_BARE_PREFIXES) {
          if (target === prefix || target.startsWith(prefix + "/") || target.startsWith(prefix + ":")) {
            err(spec, `TCB boundary violation: '${target}' is a TCB-only dependency`);
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(stmt)) {
      err(stmt, "TCB boundary violation: import= forbidden in src/verified/**");
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      err(node, "TCB boundary violation: dynamic import() in src/verified/**");
    }
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      const p = node.parent;
      const isDeclName =
        p &&
        (((ts.isFunctionDeclaration(p) || ts.isParameter(p) || ts.isVariableDeclaration(p) ||
          ts.isPropertySignature(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) &&
          p.name === node));
      if (!isDeclName) err(node, `TCB boundary violation: global '${node.text}' in src/verified/**`);
    }
    // require(...) calls
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      err(node, "TCB boundary violation: require() in src/verified/**");
    }
    ts.forEachChild(node, visit);
  };
  const setParents = (node, parent) => {
    node.parent = parent;
    ts.forEachChild(node, (c) => setParents(c, node));
  };
  setParents(sf, null);
  ts.forEachChild(sf, visit);
  return errors;
}

function main() {
  const target = process.argv[2] ?? VERIFIED;
  const files = listFiles(target);
  let errors = [];
  for (const f of files) errors.push(...checkFile(f, target));
  if (errors.length > 0) {
    console.log("✗ TCB boundary violations:");
    for (const e of errors) console.log(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ Import boundaries (${files.length} Verified files, no outside-world imports)`);
}

main();
