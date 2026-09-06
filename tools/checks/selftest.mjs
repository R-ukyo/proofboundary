// TCB — checker self-test (trusted).
//
// Proves the checkers actually detect violations (§18): builds temp copies of
// src/verified/** with injected violations and asserts the checkers FAIL on
// them. If a checker ever passes on violated code, THIS step fails the build
// ("checker is blind"). Runs entirely in a temp dir; the real tree is untouched.

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function run(tool, dir) {
  const r = spawnSync("node", [path.join(HERE, tool), dir], { stdio: "pipe" });
  return r.status === 0;
}

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pb-selftest-"));
  let failed = 0;
  const check = (name, cond) => {
    if (cond) console.log(`✓ self-test: ${name}`);
    else {
      failed++;
      console.log(`✗ self-test FAILED: ${name}`);
    }
  };

  // Case A: smuggled bare import (typechecks fine — only the boundary sees it).
  const dirA = path.join(base, "a", "verified");
  copyDir(path.join(REPO, "src", "verified"), dirA);
  fs.appendFileSync(
    path.join(dirA, "domain", "todo.ts"),
    '\nimport { z } from "zod";\nexport const _smuggled = z.string();\n',
  );
  check("bare 'zod' import rejected by boundary", run("boundary.mjs", dirA) === false);
  check("bare 'zod' import not subset's concern (passes subset)", run("subset.mjs", dirA) === true);

  // Case B: outside-world global.
  const dirB = path.join(base, "b", "verified");
  copyDir(path.join(REPO, "src", "verified"), dirB);
  fs.appendFileSync(
    path.join(dirB, "usecases", "todos.ts"),
    '\nexport const _leak = fetch("http://example.com");\n',
  );
  check("fetch() rejected by boundary", run("boundary.mjs", dirB) === false);
  check("fetch() rejected by subset", run("subset.mjs", dirB) === false);

  // Case C: out-of-subset cast (boundary-clean, subset must catch).
  const dirC = path.join(base, "c", "verified");
  copyDir(path.join(REPO, "src", "verified"), dirC);
  fs.appendFileSync(
    path.join(dirC, "domain", "todo.ts"),
    '\nexport const _casted = {} as { id: string };\n',
  );
  check("'as' cast rejected by subset", run("subset.mjs", dirC) === false);
  check("'as' cast not boundary's concern (passes boundary)", run("boundary.mjs", dirC) === true);

  // Sanity: pristine tree passes both.
  const dirOk = path.join(base, "ok", "verified");
  copyDir(path.join(REPO, "src", "verified"), dirOk);
  check(
    "pristine tree passes both checkers",
    run("subset.mjs", dirOk) === true && run("boundary.mjs", dirOk) === true,
  );

  fs.rmSync(base, { recursive: true, force: true });
  if (failed > 0) {
    console.log("self-test: CHECKERS ARE BLIND");
    process.exit(1);
  }
  console.log("self-test: checkers detect violations");
}

main();
