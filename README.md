# ProofBoundary — Verified / TCB split TODO API (PoC)

Question under test: **can AI-generated application code be treated as
mechanically-verified code, limiting human review to a small TCB?**

This repo does not try to be a good web app. It tries to make one thing
unambiguous: *what is proved, what is merely trusted, and how the machine
checks the difference.* See [`DESIGN.md`](DESIGN.md) for the decisions taken
before implementation.

## Quickstart (host needs only Docker + Compose)

```bash
docker compose build
docker compose up            # API on http://localhost:3000 (PostgreSQL inside compose)
docker compose run --rm app npm run verify   # full verification (CI entrypoint)
docker compose run --rm app npm test          # tests only
docker compose run --rm app npm run metrics   # Verified LOC vs TCB LOC
```

`make verify | make test | make up` wraps the same commands (optional).

```bash
curl -X POST localhost:3000/todos -H 'content-type: application/json' -d '{"title":"first"}'
curl localhost:3000/todos
ID=<id from above>
curl -X POST localhost:3000/todos/$ID/complete
```

## Architecture

```text
HTTP JSON
  ↓  parse (unknown bytes)
TCB adapter (src/tcb/http/server.ts)
  ↓  runtime validation (zod: unknown → trusted domain value)
Verified Use Case (src/verified/usecases/todos.ts)
  ↓  pure domain call + Port call
Repository Contract (src/verified/contracts/todoRepository.ts — interface only)
  ↓  TCB DB adapter (src/tcb/db/pgTodoRepository.ts)
PostgreSQL
```

Which file is Verified and which is TCB is decided **mechanically**:
everything under `src/verified/**` must pass the subset + boundary checkers;
everything else application-side is TCB by construction.

## Trust model

| Area | Files | Guarantee |
|---|---|---|
| Verified Tier 1 (SMT-proved) | `src/verified/domain/todo.ts` | Contracts proved for **all** inputs by Z3 (UNSAT) |
| Verified Tier 2 (checked + tested) | `src/verified/contracts/`, `src/verified/usecases/` | Subset + boundary checked, unit tested; persistence **assumed** via the Port |
| TCB (trusted, human-reviewed) | `src/tcb/**`, `tools/**` | Kept small, logic-free; listed below |
| Trusted infrastructure | Node.js, PostgreSQL, `pg`, `zod`, `z3-solver`, `tsc` | Assumed correct (see Non-guarantees) |

Verified Code reaches the outside world only through the Port
(`TodoRepository`); TCB never makes business decisions (no `if
(todo.completed)` outside Verified Code — the HTTP layer only maps use-case
results to status codes).

## Verification guarantee

For `createTodo`: any input with `1 <= title.length <= 200` produces output
with identical `id`/`title` and `completed == false`. For `completeTodo`: any
input with `completed == false` produces output with identical `id`/`title`
and `completed == true`. Field preservation is part of the proved
postcondition, not just the flag flip. The prover checks
`Pre ∧ output=Impl ∧ ¬Post` for satisfiability over Z3's String/Bool/Int
theories; UNSAT = holds for all inputs. SAT = prints input/output values from
the model as a counterexample (see sample output in `npm run verify`).

What each `npm run verify` step guarantees:

1. **Type check** (`tsc`) — the whole tree is well-typed (necessary, not sufficient).
2. **Verified subset** — Verified files use only the translatable fragment
   (no `any`/`as`/`!`/`throw`/loops/`await` outside usecases, no closures…).
3. **Import boundaries** — Verified files import nothing outside
   `src/verified/**` (no `pg`/`zod`/`node:*`/globals).
4. **Boundary self-test** — the checkers are tested against injected
   violations (`zod` smuggling, `fetch`, `as`-cast); blind checkers fail the build.
5. **Contract verification** — Z3 proofs for both functions **plus**
   rejection of `fixtures/invalid/*` (known-bad implementations must NOT prove).
6. **Tests** — runtime behavior of domain, use cases (fake Port), and HTTP mapping.

## Non-guarantees (explicit assumptions)

- PostgreSQL stores/returns rows faithfully; `pg` maps them correctly.
- The TCB adapter implements the Port contract (`save` persists exactly what
  it receives); zod schemas match the domain predicates (`min(1).max(200)`).
- Node.js / HTTP transport is faithful; `z3-solver` (Z3 WASM) answers correctly.
- `tsc` parsing used by the checkers/prover is correct.
- The formal postconditions capture what the natural-language requirement means.

## TCB (complete application-side list)

```text
src/tcb/http/server.ts            # routing, body parsing, status mapping (no business rules)
src/tcb/validation/todoSchemas.ts # zod boundary: unknown → domain value
src/tcb/db/pgTodoRepository.ts    # Port implementation (mapping trusted, not proved)
src/tcb/db/schema.ts              # DDL
src/tcb/runtime/main.ts           # env, pool, listen
tools/verifier/verify.mjs         # AST→Z3 prover (trusted to encode faithfully)
tools/checks/subset.mjs           # subset checker (trusted)
tools/checks/boundary.mjs         # boundary checker (trusted)
tools/checks/selftest.mjs         # checker self-test
tools/verify-all.mjs              # pipeline wiring
tools/metrics/metrics.mjs         # LOC counting
```

## Measured trust size (`npm run metrics`)

```text
Application code: 238 LOC
Verified:          69 LOC
TCB:              169 LOC
TCB ratio:         71.0%
```

The ratio looks inverted for a 3-endpoint toy because TCB is almost entirely
*fixed* infrastructure (HTTP parsing, SQL mapping) while Verified grows with
business rules. The operational claim is marginal: adding domain logic adds ~0
TCB. Shrinking the fixed part further means shared libraries / generated
adapters (see evaluation §8), not hand-smaller handlers — switching to a web
framework would *reduce* this number while *increasing* actual trust, which is
why the metric counts only first-party `src/` code and frameworks stay out.

## Evaluation (the 10 questions)

1. **Which TypeScript fragment verified realistically?** Pure first-order
   functions over `{string, boolean, number}` object shapes with `===`, `&&`,
   `||`, `!`, ternaries, and string `.length`. Enough for state transitions and
   constructors — the core of CRUD business logic.
2. **Subset constraints needed?** Total ban on `any`/`unknown`/`as`/`!`,
   I/O, async (domain tier), loops, exceptions, closures, classes, dynamic
   access, and all bare imports. Fail-closed translation: anything unmodelable
   is an error, never silently skipped.
3. **What remained in the TCB?** HTTP parsing/routing, zod validation, the pg
   adapter + DDL, process wiring, and the verifier toolchain itself.
4. **What share?** 71% here (fixed-cost dominated; see above).
5. **Can humans skip reading Verified diffs?** For Tier 1 pure functions: yes,
   *provided* the human still reviews the Requires/Ensures specs — the proof
   is relative to them. That is the correct division of labor: humans review
   *what should hold*, machines check *that it holds for all inputs*.
6. **What still needs humans?** Specs, the TCB files, schema↔predicate
   correspondence (zod bounds vs `Requires`), and the Port assumption.
7. **How dangerous is the DB assumption?** Contained: the adapter is ~36 LOC of
   straight-line mapping with no branching; the risky part (SQL generation) is
   delegated to `pg` parameter binding, and row shapes are re-validated with
   zod on read.
8. **How to shrink TCB further?** Generate the HTTP+validation+adapter layer
   from the Verified interfaces (one generator = one review), or share one
   audited CRUD runtime across services.
9. **Biggest obstacle to real adoption?** Spec authorship: writing precise
   pre/postconditions for rich domains, and keeping runtime validators in sync
   with domain predicates (today trusted by inspection).
10. **AI generate → counterexample → repair loop?** Yes — this PoC already
    produces the required signal: machine-readable verdict + concrete
    input/output counterexample (see mutation output). The next step is feeding
    that text back to a generator; no new verification machinery is needed.
