// TCB — single verification entrypoint: `npm run verify`.
// Runs type check, subset check, boundary check, SMT proofs (+mutations), tests.

import { spawnSync } from "node:child_process";

const steps = [
  { label: "Type check", cmd: "npm", args: ["run", "build"] },
  { label: "Verified subset", cmd: "node", args: ["tools/checks/subset.mjs"] },
  { label: "Import boundaries", cmd: "node", args: ["tools/checks/boundary.mjs"] },
  { label: "Generated validators", cmd: "node", args: ["tools/codegen/validators.mjs", "--check"] },
  { label: "Boundary self-test", cmd: "node", args: ["tools/checks/selftest.mjs"] },
  { label: "Contract verification", cmd: "node", args: ["tools/verifier/verify.mjs"] },
  { label: "Tests", cmd: "npm", args: ["test"] },
];

const results = [];
for (const s of steps) {
  console.log(`--- ${s.label} ---`);
  const r = spawnSync(s.cmd, s.args, { stdio: "inherit", shell: false });
  const ok = r.status === 0;
  results.push({ label: s.label, ok });
  if (!ok) break;
}

console.log("");
const proofsOk = results.every((r) => r.ok);
const mark = (ok) => (ok ? "✓" : "✗");
const find = (l) => results.find((r) => r.label === l)?.ok === true;
console.log(`${mark(find("Type check"))} Type check`);
console.log(`${mark(find("Verified subset"))} Verified subset`);
console.log(`${mark(find("Import boundaries"))} Import boundaries`);
console.log(`${mark(find("Generated validators"))} Generated validators fresh`);
console.log(`${mark(find("Boundary self-test"))} Boundary self-test (checkers reject violations)`);
console.log(`${mark(find("Contract verification"))} Contract proofs + mutation rejection`);
console.log(`${mark(find("Tests"))} Tests`);
console.log("");
console.log(proofsOk ? "VERIFICATION PASSED" : "VERIFICATION FAILED");
process.exit(proofsOk ? 0 : 1);
