import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://crm:crm@localhost:5432/crm", ssl: /supabase/.test(process.env.DATABASE_URL ?? "") ? { rejectUnauthorized: false } : undefined },
});
