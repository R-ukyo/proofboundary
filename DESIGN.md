# DESIGN MEMO — Verified / TCB split PoC (TODO API)

Date: 2026-09-06. Decided before implementation. This memo is the spec; code must follow it.

## 1. Verified subset (machine-enforced)

Location: `src/verified/**` only. Rule: **if it can't be translated to SMT, it doesn't belong here.**

Allowed:
- `interface` / `type` with fields of `string | boolean | number` only (+ branded string via intersection is NOT allowed — keep plain).
- `export function f(args: T): U { ... }` — sync only, single `return` (plus `const` bindings of pure exprs before it).
- Pure expressions only: object literals `{...}`, spread `...x`, property access `a.b`, `===`, `!==`, `&&`, `||`, `!`, literals, ternary `?:`, string `.length`, comparisons `< <= > >=` on numbers.
- Relative imports from `src/verified/**` only (`import type` or value import of pure helpers). No bare-specifier imports at all.

Denied (subset checker fails the build):
- `any`, `unknown`, `as`, `!` (non-null assertion), `eval`, `Function`, `Proxy`, `Reflect`
- `async`/`await`, `Promise`, `throw`/`try`/`catch`, `for`/`while`/`do`, `let`/`var` reassignment (only `const`), `class`/`this`/`new` (except none), `enum`
- `fetch`, `process`, `fs`, `path`, `console`, `Date.now`, `Math.random`, `crypto`, `setTimeout`
- Dynamic access `a[b]`, `Object.keys/assign`, spread of `any`, recursion (function calling itself), default mutable exports (`let` at top level)
- Bare imports: `pg`, `hono`, `express`, `fastify`, `zod`, `@prisma/*`, `drizzle*`, any `node:*` — entire bare-import list is denied in verified/.

Rationale: this subset maps 1:1 onto Z3 theories (Bool, String, Ints for lengths). Anything else is rejected rather than silently unmodeled.
ESLint-level vs solver-level split: syntax/ban rules = AST checker (fast, no solver); semantic contract validity = Z3 (needs solver).

## 2. TCB boundary

- Verified (`src/verified/`): `domain/todo.ts` (types + `createTodo`, `completeTodo` pure fns + `*Requires/*Ensures` spec fns), `contracts/todoRepository.ts` (Port interface only, no impl), `usecases/*.ts` (orchestration over the Port, no I/O primitives — takes Port as argument; async allowed here ONLY to await Port, still no direct imports).
  - Note: usecases are boundary-checked + type-checked + unit-tested, but SMT-proved only insofar as they call proved pure fns. SMT scope = pure core. This is stated in README as a delimited guarantee, not hidden.
- TCB (`src/tcb/`): `http/server.ts` (node:http routing, parse/serialize only), `validation/*` (zod schemas: unknown → trusted domain value), `db/pgTodoRepository.ts` (pg adapter implementing the Port), `runtime/*` (env, main, connection wiring). TCB may import `pg`, `zod`, `node:*`. TCB MUST NOT contain business rules (no `if (todo.completed)` decisions — it calls verified usecases).
- Verifier itself (`tools/verifier/`, `tools/checks/`) is TCB: we trust tsc, the AST checker, z3-solver (Z3 WASM), and Node. Listed in README Assumptions.
- Mechanical判定: `tools/checks/boundary.mjs` (pure-Node, no deps) scans `src/verified/**` imports/identifiers and fails on any violation. No human judgment involved.

## 3. Verification mechanism (real SMT, not typecheck theater)

- `tools/verifier/verify.mjs` uses the TypeScript compiler API to parse the ACTUAL `src/verified/domain/todo.ts` source: it extracts (a) each target impl function body, (b) its Requires/Ensures spec function bodies, and translates supported AST nodes to `z3-solver` terms.
- Theories: Bool + String + Int (string length). `title.length` → `Length(title)`.
- Query per function: `Pre(input) ∧ output = Impl(input) ∧ ¬Post(input, output)`. `unsat` = proved; `sat` = model evaluated to print `Counterexample: input.../ output...`.
- The translation is total over the subset: any unsupported AST node → verification ERROR (fail-closed), never skipped. So an AI generating out-of-subset code cannot silently pass.
- Negative control: `fixtures/invalid/*.ts` are buggy copies (e.g. `completed:false`, `title:""`); `npm run verify` also runs the prover over each fixture and FAILS THE BUILD if any fixture verifies (i.e. the prover must reject known-bad code). This proves detection, not just acceptance.

## 4. SMT solver usage

- `z3-solver` npm package (Z3 compiled to WASM, real Z3 decision procedure) inside the `app` Docker image. No host Z3, no network, no Python needed. `Solver.check()` → `sat/unsat`. Models give counterexamples.
- Alternative considered (system Z3 + SMT-LIB files + Python): rejected — bigger image, harder `npm run verify` single-command story, same solving power for this fragment.

## 5. Docker composition

- `Dockerfile`: `node:20-slim`, `npm ci`, copies repo, compiles TS. No host Node/npm/Z3 needed.
- `compose.yaml`: `app` (built) + `db` (`postgres:16-alpine`, named volume, healthcheck). App connects via `DATABASE_URL`.
- Commands (all container-side): `docker compose build`, `docker compose up`, `docker compose run --rm app npm run verify|test|metrics`. Makefile wraps the same commands but is optional.

## 6. Guarantees (what UNSAT actually means)

- For ALL strings/bools in scope: if `Requires` holds, the implementation's output satisfies `Ensures` — including field-preservation clauses (`output.id == input.id`, `output.title == input.title`), not just `completed == true`.
- createTodo: valid-title input ⇒ title passthrough + `completed == false` (+ id passthrough).
- completeTodo: `completed == false` input ⇒ id/title preserved + `completed == true`.

## 7. Non-guarantees (explicit Assumptions)

Postgres behaves correctly; pg driver maps rows faithfully; zod validators match domain predicates; Node/http transport is faithful; z3-solver answers correctly; natural-language requirement ("completed means done") is correctly formalized in Ensures. DB persistence (`save` stores what it's given) is ASSUMED via the Port contract, not proved. Use-case ↔ Port wiring is tested, not SMT-proved.
