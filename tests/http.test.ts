// TCB-side test (HTTP behavior with an in-memory Port implementation).
// Tests live outside src/verified and may use fetch/sockets freely.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Todo } from "../src/verified/specs/todo.js";
import type { TodoRepository } from "../src/verified/contracts/todoRepository.js";
import { createAppServer } from "../src/tcb/http/server.js";

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

describe("HTTP API", () => {
  let server: Server;
  let base = "";

  before(async () => {
    server = createAppServer(new MemoryRepo());
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        base = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject: (e: unknown) => void) => {
      server.close((e: unknown) => {
        if (e) reject(e);
        else resolve();
      });
    });
  });

  it("POST /todos -> GET /todos -> POST /todos/:id/complete", async () => {
    const createdRes = await fetch(`${base}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "http todo" }),
    });
    assert.equal(createdRes.status, 201);
    const created = (await createdRes.json()) as Todo;
    assert.equal(created.title, "http todo");
    assert.equal(created.completed, false);

    const listRes = await fetch(`${base}/todos`);
    assert.equal(listRes.status, 200);
    const listed = (await listRes.json()) as Todo[];
    assert.equal(listed.length, 1);

    const doneRes = await fetch(`${base}/todos/${created.id}/complete`, { method: "POST" });
    assert.equal(doneRes.status, 200);
    const done = (await doneRes.json()) as Todo;
    assert.equal(done.completed, true);
    assert.equal(done.title, "http todo");
  });

  it("rejects empty title with 400", async () => {
    const res = await fetch(`${base}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    assert.equal(res.status, 400);
  });

  it("completing unknown id yields 404, repeating yields 409", async () => {
    const nf = await fetch(`${base}/todos/nope/complete`, { method: "POST" });
    assert.equal(nf.status, 404);

    const createdRes = await fetch(`${base}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "twice" }),
    });
    const created = (await createdRes.json()) as Todo;
    await fetch(`${base}/todos/${created.id}/complete`, { method: "POST" });
    const again = await fetch(`${base}/todos/${created.id}/complete`, { method: "POST" });
    assert.equal(again.status, 409);
  });
});
