import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Todo } from "../src/verified/domain/todo.js";
import type { TodoRepository } from "../src/verified/contracts/todoRepository.js";
import {
  completeTodoUseCase,
  createTodoUseCase,
  listTodosUseCase,
} from "../src/verified/usecases/todos.js";

class MemoryRepo implements TodoRepository {
  private readonly store: Map<string, Todo> = new Map();

  public async findById(id: string): Promise<Todo | null> {
    return this.store.get(id) ?? null;
  }

  public async list(): Promise<readonly Todo[]> {
    return [...this.store.values()];
  }

  public async save(todo: Todo): Promise<void> {
    this.store.set(todo.id, todo);
  }
}

describe("todo use cases", () => {
  it("create -> list -> complete preserves fields", async () => {
    const repo = new MemoryRepo();
    const created = await createTodoUseCase(repo, { id: "1", title: "hello" });
    assert.equal(created.completed, false);

    const listed = await listTodosUseCase(repo);
    assert.equal(listed.length, 1);

    const done = await completeTodoUseCase(repo, "1");
    assert.ok(!("kind" in (done as object)));
    const todo = done as Todo;
    assert.equal(todo.id, "1");
    assert.equal(todo.title, "hello");
    assert.equal(todo.completed, true);

    const stored = await repo.findById("1");
    assert.equal(stored?.completed, true);
    assert.equal(stored?.title, "hello");
  });

  it("completing an unknown id yields not-found", async () => {
    const repo = new MemoryRepo();
    const result = await completeTodoUseCase(repo, "missing");
    assert.deepEqual(result, { kind: "not-found" });
  });

  it("completing twice yields already-completed", async () => {
    const repo = new MemoryRepo();
    await createTodoUseCase(repo, { id: "2", title: "once" });
    await completeTodoUseCase(repo, "2");
    const again = await completeTodoUseCase(repo, "2");
    assert.deepEqual(again, { kind: "already-completed" });
  });
});
