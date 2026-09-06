// TCB — HTTP layer. Allowed to: parse, validate, call use cases, serialize.
// Forbidden: business rules. There is no `if (todo.completed)` here — the
// use case decides; this file only maps use-case results to status codes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { TodoRepository } from "../../verified/contracts/todoRepository.js";
import {
  completeTodoUseCase,
  createTodoUseCase,
  listTodosUseCase,
  reopenTodoUseCase,
} from "../../verified/usecases/todos.js";
import { CreateTodoBody, TodoIdParam } from "../validation/todoSchemas.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload: string = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject: (err: unknown) => void) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text: string = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}

export function createAppServer(repo: TodoRepository): Server {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, repo).catch(() => {
      if (!res.writableEnded) {
        sendJson(res, 500, { error: "internal-error" });
      }
    });
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repo: TodoRepository,
): Promise<void> {
  const method: string = req.method ?? "";
  const url: string = req.url ?? "/";

  if (method === "POST" && url === "/todos") {
    const raw: unknown = await readBody(req);
    const parsed = CreateTodoBody.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 400, { error: "invalid-body" });
      return;
    }
    const created = await createTodoUseCase(repo, { id: randomUUID(), title: parsed.data.title });
    sendJson(res, 201, created);
    return;
  }

  if (method === "GET" && url === "/todos") {
    const todos = await listTodosUseCase(repo);
    sendJson(res, 200, todos);
    return;
  }

  if (method === "POST" && url.startsWith("/todos/") && url.endsWith("/complete")) {
    const idSegment: string = url.slice("/todos/".length, -"/complete".length);
    const idCheck = TodoIdParam.safeParse(idSegment);
    if (!idCheck.success) {
      sendJson(res, 400, { error: "invalid-id" });
      return;
    }
    const result = await completeTodoUseCase(repo, idCheck.data);
    if (typeof result === "object" && result !== null && "kind" in result) {
      if (result.kind === "not-found") {
        sendJson(res, 404, { error: "not-found" });
        return;
      }
      sendJson(res, 409, { error: "already-completed" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && url.startsWith("/todos/") && url.endsWith("/reopen")) {
    const idSegment: string = url.slice("/todos/".length, -"/reopen".length);
    const idCheck = TodoIdParam.safeParse(idSegment);
    if (!idCheck.success) {
      sendJson(res, 400, { error: "invalid-id" });
      return;
    }
    const result = await reopenTodoUseCase(repo, idCheck.data);
    if (typeof result === "object" && result !== null && "kind" in result) {
      if (result.kind === "not-found") {
        sendJson(res, 404, { error: "not-found" });
        return;
      }
      sendJson(res, 409, { error: "already-open" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "not-found" });
}
