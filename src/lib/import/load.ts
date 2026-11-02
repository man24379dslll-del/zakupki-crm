import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { UserError } from "@/lib/forms";
import { getFile } from "@/lib/storage";
import { parseWorkbook, type ColumnMapping, type SheetKind } from "./parser";
import type { ImportSettings } from "./importer";

export interface StoredImport {
  file: string;
  settings: ImportSettings;
  overrides: Record<string, { kind?: SheetKind; mapping?: ColumnMapping; headerRow?: number }>;
}

export async function loadImport(batchId: string) {
  const [b] = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, batchId));
  if (!b) throw new UserError("Импорт не найден");
  const st = b.settings as StoredImport;
  if (!st?.file) throw new UserError("Этот импорт выполнен из командной строки — исходный файл не сохранён в системе, предпросмотр недоступен.");
  const buf = await getFile(st.file);
  const parsed = await parseWorkbook(buf, b.fileName, st.overrides);
  return { batch: b, stored: st, parsed };
}

