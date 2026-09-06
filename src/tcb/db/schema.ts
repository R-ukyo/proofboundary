// TCB — PostgreSQL DDL. Trusted as "migration", executed at startup.

import type { Pool } from "pg";

export async function ensureTodoSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      completed BOOLEAN NOT NULL
    )
  `);
}
