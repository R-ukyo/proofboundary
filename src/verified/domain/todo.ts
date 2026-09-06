// VERIFIED CODE — Tier 1 (SMT-proved pure core).
//
// This file must stay inside the Verified subset (see DESIGN.md):
// pure functions, single return, no imports, no I/O, no any/as/!/throw/loops.
// The prover (tools/verifier/verify.mjs) parses THESE function bodies and
// translates them to Z3. Any out-of-subset syntax fails verification closed.

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

export interface NewTodoInput {
  id: string;
  title: string;
}

// --- createTodo -------------------------------------------------------------

export function createTodoRequires(input: NewTodoInput): boolean {
  return input.title.length >= 1 && input.title.length <= 200;
}

export function createTodoEnsures(input: NewTodoInput, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === false;
}

export function createTodo(input: NewTodoInput): Todo {
  return { id: input.id, title: input.title, completed: false };
}

// --- completeTodo -----------------------------------------------------------

export function completeTodoRequires(todo: Todo): boolean {
  return todo.completed === false;
}

export function completeTodoEnsures(input: Todo, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === true;
}

export function completeTodo(todo: Todo): Todo {
  return { id: todo.id, title: todo.title, completed: true };
}
