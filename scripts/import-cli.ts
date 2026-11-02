/** Импорт Excel из командной строки (то же, что в интерфейсе): tsx scripts/import-cli.ts файл.xlsx [--dry] */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "../src/db";
import { parseWorkbook } from "../src/lib/import/parser";
import { buildPreview, defaultSettings, executeImport } from "../src/lib/import/importer";

(async () => {
  const file = process.argv[2];
  const p = await parseWorkbook(readFileSync(file), path.basename(file));
  const s = defaultSettings(p);
  const pr = await buildPreview(p, s);
  console.log(JSON.stringify({ counts: pr.counts, merges: pr.merges.slice(0, 20), sheets: pr.sheets.map((x) => ({ n: x.name, e: x.enabled, t: x.totals, x: x.excel })) }, null, 1));
  if (process.argv.includes("--dry")) return pool.end();
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.login, "admin"));
  const [b] = await db.insert(schema.importBatches).values({ fileName: path.basename(file), createdById: admin.id, status: "preview", settings: s }).returning();
  const t = Date.now();
  console.log(await executeImport(p, s, b.id, admin.id), (Date.now() - t) / 1000, "s");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
