import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS servers (
      job_id        TEXT PRIMARY KEY,
      place_id      BIGINT NOT NULL,
      sea           INTEGER NOT NULL,
      first_seen    BIGINT NOT NULL,
      last_seen     BIGINT NOT NULL,
      player_count  INTEGER NOT NULL DEFAULT 0,
      max_players   INTEGER NOT NULL DEFAULT 0,
      scan_count    INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pool.query(`
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 1
  `);
}

export async function wipeServers(): Promise<void> {
  await pool.query(`DELETE FROM servers`);
}

export * from "./schema";
