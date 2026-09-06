import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeTodo,
  completeTodoEnsures,
  completeTodoRequires,
  createTodo,
  createTodoEnsures,
  createTodoRequires,
} from "../src/verified/domain/todo.js";

describe("createTodo (runtime behavior)", () => {
  it("passes title through and starts uncompleted", () => {
    const out = createTodo({ id: "a", title: "buy milk" });
    assert.equal(out.id, "a");
    assert.equal(out.title, "buy milk");
    assert.equal(out.completed, false);
    assert.equal(createTodoEnsures({ id: "a", title: "buy milk" }, out), true);
  });

  it("requires a valid title", () => {
    assert.equal(createTodoRequires({ id: "a", title: "ok" }), true);
    assert.equal(createTodoRequires({ id: "a", title: "" }), false);
  });
});

describe("completeTodo (runtime behavior)", () => {
  it("preserves id/title and sets completed", () => {
    const input = { id: "x", title: "keep me", completed: false };
    const out = completeTodo(input);
    assert.equal(out.id, "x");
    assert.equal(out.title, "keep me");
    assert.equal(out.completed, true);
    assert.equal(completeTodoRequires(input), true);
    assert.equal(completeTodoEnsures(input, out), true);
  });

  it("requires an uncompleted todo", () => {
    assert.equal(completeTodoRequires({ id: "x", title: "t", completed: true }), false);
  });
});
