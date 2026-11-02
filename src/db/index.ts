import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Supabase и другие облачные Postgres требуют SSL; сертификат пулера Supabase не проверяем (соединение всё равно шифруется) */
export function poolConfig() {
  const url = process.env.DATABASE_URL;
  const ssl = process.env.DATABASE_SSL === "true" || /supabase\.(co|com)/.test(url ?? "") ? { rejectUnauthorized: false } : undefined;
  return { connectionString: url?.replace(/[?&]sslmode=[^&]*/g, ""), ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 10) };
}

const g = globalThis as unknown as { __pool?: Pool };
export const pool = g.__pool ?? new Pool(poolConfig());
if (process.env.NODE_ENV !== "production") g.__pool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
