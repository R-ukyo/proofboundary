// INVALID fixture (negative control): reopenTodo keeps the flag set.
// The prover MUST refute reopenTodo here with a counterexample.

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

export interface NewTodoInput {
  id: string;
  title: string;
}

export function createTodoRequires(input: NewTodoInput): boolean {
  return input.title.length >= 1 && input.title.length <= 200;
}

export function createTodoEnsures(input: NewTodoInput, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === false;
}

export function createTodo(input: NewTodoInput): Todo {
  return { id: input.id, title: input.title, completed: false };
}

export function completeTodoRequires(todo: Todo): boolean {
  return todo.completed === false;
}

export function completeTodoEnsures(input: Todo, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === true;
}

export function completeTodo(todo: Todo): Todo {
  return { id: todo.id, title: todo.title, completed: true };
}

export function reopenTodoRequires(todo: Todo): boolean {
  return todo.completed === true;
}

export function reopenTodoEnsures(input: Todo, output: Todo): boolean {
  return output.id === input.id && output.title === input.title && output.completed === false;
}

export function reopenTodo(todo: Todo): Todo {
  return { id: todo.id, title: todo.title, completed: true };
}
