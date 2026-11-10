import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; module functions accept `Db | Tx` so they compose inside transactions. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __aacPool?: pg.Pool; __aacDb?: Db };

function createPool() {
  return new pg.Pool({ connectionString: env.databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 10) });
}

export const pool: pg.Pool = globalForDb.__aacPool ?? (globalForDb.__aacPool = createPool());
export const db: Db = globalForDb.__aacDb ?? (globalForDb.__aacDb = drizzle(pool, { schema }));

export { schema };
