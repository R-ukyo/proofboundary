// TCB — TodoRepository adapter (pg). TRUSTED to implement the Port
// contract faithfully: save stores exactly what it receives; findById/list
// return stored rows unchanged. This mapping is assumed, not proved.

import type { Pool } from "pg";
import type { Todo } from "../../verified/specs/todo.js";
import type { TodoRepository } from "../../verified/contracts/todoRepository.js";
import { TodoRow } from "../validation/todoSchemas.js";

function toDomain(row: unknown): Todo {
  const parsed: TodoRow = TodoRow.parse(row);
  const todo: Todo = { id: parsed.id, title: parsed.title, completed: parsed.completed };
  return todo;
}

export class PgTodoRepository implements TodoRepository {
  private readonly pool: Pool;

  public constructor(pool: Pool) {
    this.pool = pool;
  }

  public async findById(id: string): Promise<Todo | null> {
    const result = await this.pool.query("SELECT id, title, completed FROM todos WHERE id = $1", [
      id,
    ]);
    const row: unknown = result.rows[0] ?? null;
    if (row === null) {
      return null;
    }
    return toDomain(row);
  }

  public async list(): Promise<readonly Todo[]> {
    const result = await this.pool.query("SELECT id, title, completed FROM todos ORDER BY id");
    return result.rows.map(toDomain);
  }

  public async save(todo: Todo): Promise<void> {
    await this.pool.query(
      `INSERT INTO todos (id, title, completed) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, completed = EXCLUDED.completed`,
      [todo.id, todo.title, todo.completed],
    );
  }
}
