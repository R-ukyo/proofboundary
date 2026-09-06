// VERIFIED CODE — Tier 1 impl (MACHINE-CHECKED, no human review needed).
//
// This file defines HOW: pure function bodies only. Specs (what must hold)
// live in src/verified/specs/todo.ts and are human-reviewed.
// If `npm run verify` proves this file against those specs (UNSAT), reviewers
// may skip reading it. See docs/REVIEW_POLICY.md.
//
// Rules: this file must stay inside the Verified subset (see DESIGN.md).
// Spec function names referenced here must exist in the specs file; the prover
// enforces the pairing structurally (unregistered impls fail closed).

import type { NewTodoInput, Todo } from "../specs/todo.js";

// --- createTodo -------------------------------------------------------------

export function createTodo(input: NewTodoInput): Todo {
  return { id: input.id, title: input.title, completed: false };
}

// --- completeTodo -----------------------------------------------------------

export function completeTodo(todo: Todo): Todo {
  return { id: todo.id, title: todo.title, completed: true };
}
