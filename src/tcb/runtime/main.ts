// TCB — process wiring (env, sockets, startup order). No business logic.

import { Pool } from "pg";
import { ensureTodoSchema } from "../db/schema.js";
import { PgTodoRepository } from "../db/pgTodoRepository.js";
import { createAppServer } from "../http/server.js";

const connectionString: string | undefined = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is required");
}
const port: number = Number(process.env["PORT"] ?? "3000");

const pool: Pool = new Pool({ connectionString });
const repo: PgTodoRepository = new PgTodoRepository(pool);
const server = createAppServer(repo);

async function main(): Promise<void> {
  await ensureTodoSchema(pool);
  server.listen(port, () => {
    process.stdout.write(`listening on ${port}\n`);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${String(err)}\n`);
  process.exitCode = 1;
});
