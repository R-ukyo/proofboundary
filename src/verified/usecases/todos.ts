// VERIFIED CODE — Tier 2 (orchestration over the Port; no I/O primitives).
//
// Rules for this tier: may use async/await and the Repository Port, but must
// NOT import anything outside src/verified/**, must NOT throw, and must NOT
// duplicate business rules — all state decisions come from domain functions.

import type { NewTodoInput, Todo } from "../specs/todo.js";
import { completeTodo, createTodo, reopenTodo } from "../impl/todo.js";
import type { TodoRepository } from "../contracts/todoRepository.js";

export interface NotFound {
  readonly kind: "not-found";
}

export interface AlreadyCompleted {
  readonly kind: "already-completed";
}

export interface AlreadyOpen {
  readonly kind: "already-open";
}

export async function createTodoUseCase(
  repo: TodoRepository,
  input: NewTodoInput,
): Promise<Todo> {
  const todo: Todo = createTodo(input);
  await repo.save(todo);
  return todo;
}

export async function listTodosUseCase(repo: TodoRepository): Promise<readonly Todo[]> {
  const todos: readonly Todo[] = await repo.list();
  return todos;
}

export async function completeTodoUseCase(
  repo: TodoRepository,
  id: string,
): Promise<Todo | NotFound | AlreadyCompleted> {
  const found: Todo | null = await repo.findById(id);
  if (found === null) {
    return { kind: "not-found" };
  }
  if (found.completed === true) {
    return { kind: "already-completed" };
  }
  const done: Todo = completeTodo(found);
  await repo.save(done);
  return done;
}

export async function reopenTodoUseCase(
  repo: TodoRepository,
  id: string,
): Promise<Todo | NotFound | AlreadyOpen> {
  const found: Todo | null = await repo.findById(id);
  if (found === null) {
    return { kind: "not-found" };
  }
  if (found.completed === false) {
    return { kind: "already-open" };
  }
  const open: Todo = reopenTodo(found);
  await repo.save(open);
  return open;
}
