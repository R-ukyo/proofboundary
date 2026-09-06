// VERIFIED CODE — Tier 2 (contract, checked + tested; persistence assumed).
//
// Port/Capability boundary: Verified Code never touches PostgreSQL/pg.
// It only speaks through this interface. The TCB adapter
// (src/tcb/db/pgTodoRepository.ts) implements it.
//
// ASSUMPTION (explicit, see README): `save` durably stores exactly the Todo
// it is given; `findById`/`list` return previously saved values faithfully.
// That assumption is trusted, not proved.

import type { Todo } from "../specs/todo.js";

export interface TodoRepository {
  findById(id: string): Promise<Todo | null>;
  list(): Promise<readonly Todo[]>;
  save(todo: Todo): Promise<void>;
}
