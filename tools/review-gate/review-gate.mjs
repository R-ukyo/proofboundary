// TCB — review gate (trusted).
//
// Classifies a change set into MACHINE_ONLY (no human review needed if the
// pipeline is green) vs NEEDS_HUMAN. The rule mirrors docs/REVIEW_POLICY.md:
// only src/verified/impl/** and tests/** are machine-gated; every other path
// carries trust (specs, usecases, TCB, tools, fixtures, docs, CI itself).
//
// Usage:
//   node tools/review-gate/review-gate.mjs --files <newline-separated-paths>
//   node tools/review-gate/review-gate.mjs <path...>            (argv list)
//   node tools/review-gate/review-gate.mjs <base-ref>           (git diff base...HEAD, needs .git)
//
// Prints per-file tags and a final `GATE: MACHINE_ONLY|NEEDS_HUMAN` line.
// Exit code is always 0 (NEEDS_HUMAN is not a failure); CI parses the GATE line.

import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const MACHINE_RE = [/^src\/verified\/impl\//, /^tests\//];

function classify(p) {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (norm === "" || norm.startsWith(".git/")) return null;
  return MACHINE_RE.some((re) => re.test(norm)) ? "machine" : "human";
}

function fileList() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--files");
  if (fi !== -1 && args[fi + 1]) {
    return fs
      .readFileSync(args[fi + 1], "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length > 0) {
    // Explicit file list, unless --base requests git-diff mode.
    const bi = args.indexOf("--base");
    if (bi === -1) return positional;
    const base = args[bi + 1] ?? "origin/main";
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  const out = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function main() {
  const files = fileList();
  if (files.length === 0) {
    console.log("GATE: MACHINE_ONLY (empty change set)");
    return;
  }
  const human = [];
  for (const f of files) {
    const c = classify(f);
    if (c === null) continue;
    console.log(`  [${c === "machine" ? "MACHINE" : "HUMAN  "}] ${f}`);
    if (c === "human") human.push(f);
  }
  if (human.length === 0) {
    console.log("GATE: MACHINE_ONLY (impl+tests only; merge when pipeline is green)");
  } else {
    console.log(`GATE: NEEDS_HUMAN (${human.length} trust-relevant file(s))`);
  }
}

main();
