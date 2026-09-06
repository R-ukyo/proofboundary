// TCB — trust-size metrics: Verified LOC vs TCB LOC over application sources.
// Counts non-blank, non-comment-only lines in src/verified/** and src/tcb/**.
// Excludes node_modules, dist, tests, fixtures, tools (verifier infra).

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

function listTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

function countLoc(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let n = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) continue;
    n++;
  }
  return n;
}

function main() {
  const groups = [
    ["Verified", path.join(REPO, "src", "verified")],
    ["TCB", path.join(REPO, "src", "tcb")],
  ];
  const rows = [];
  let verified = 0;
  let tcb = 0;
  for (const [label, dir] of groups) {
    let subtotal = 0;
    for (const f of listTs(dir)) {
      const n = countLoc(f);
      subtotal += n;
      rows.push([path.relative(REPO, f), label, n]);
    }
    if (label === "Verified") verified = subtotal;
    else tcb = subtotal;
  }
  const total = verified + tcb;
  const ratio = total === 0 ? 0 : (tcb / total) * 100;
  for (const [f, label, n] of rows) console.log(`${String(n).padStart(5)}  ${label.padEnd(8)}  ${f}`);
  console.log("");
  console.log(`Application code: ${total} LOC`);
  console.log(`Verified:         ${verified} LOC`);
  console.log(`TCB:              ${tcb} LOC`);
  console.log(`TCB ratio:        ${ratio.toFixed(1)}%`);
}

main();
