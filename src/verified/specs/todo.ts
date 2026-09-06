// VERIFIED CODE — Tier 1 specs (HUMAN-REVIEWED).
//
// This file defines WHAT must hold: types + Requires/Ensures.
// Human reviewers read THIS file, not the implementation.
// The prover (tools/verifier/verify.mjs) loads these specs together with
// src/verified/impl/todo.ts and proves the impl against them for all inputs.
//
// Changing this file changes the meaning of "correct" -> NEEDS_HUMAN review.

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

// --- completeTodo -----------------------------------------------------------

export function completeTodoRequires(todo: Todo): boolean {
  return todo.completed === false;
}

export function completeTodoEnsures(input: Todo, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === true;
}
