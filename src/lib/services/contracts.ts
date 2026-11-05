import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { logActivity } from "@/lib/audit";
import { UserError } from "@/lib/forms";
import { addDays, fmtDate } from "@/lib/format";
import { putFile } from "@/lib/storage";

/** За сколько дней до окончания договора предупреждать */
export const CONTRACT_WARN_DAYS = 30;

/** Актуальный договор поставщика: бессрочный или с самым поздним сроком (SQL для LATERAL) */
export const CURRENT_CONTRACT = (supplierAlias = "s") => sql`
  SELECT c.id, c.number, c.date, c.valid_until FROM supplier_contracts c
  WHERE c.supplier_id = ${sql.raw(supplierAlias)}.id AND c.deleted_at IS NULL
  ORDER BY c.valid_until DESC NULLS FIRST, c.date DESC NULLS LAST, c.created_at DESC LIMIT 1`;

export type ContractState = "none" | "ok" | "expiring" | "expired";

export function contractState(c: { valid_until?: string | Date | null; validUntil?: string | Date | null } | null | undefined, today: string): ContractState {
  if (!c) return "none";
  const raw = c.validUntil ?? c.valid_until ?? null;
  if (!raw) return "ok";
  const until = typeof raw === "string" ? raw.slice(0, 10) : raw.toISOString().slice(0, 10);
  if (until < today) return "expired";
  return until <= addDays(today, CONTRACT_WARN_DAYS) ? "expiring" : "ok";
}

export const CONTRACT_TONE: Record<ContractState, string> = { none: "gray", ok: "green", expiring: "amber", expired: "red" };

export function contractTitle(c: { number?: string | null; date?: string | Date | null; valid_until?: string | Date | null; validUntil?: string | Date | null } | null | undefined, today: string) {
  const st = contractState(c, today);
  if (!c || st === "none") return "Нет договора";
  const until = c.validUntil ?? c.valid_until ?? null;
  const head = `Договор${c.number ? ` № ${c.number}` : ""}${c.date ? ` от ${fmtDate(c.date)}` : ""}`;
  if (!until) return `${head}, бессрочный`;
  if (st === "expired") return `${head} — истёк ${fmtDate(until)}`;
  const days = Math.round((new Date(fmtIso(until) + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
  return st === "expiring" ? `${head} — истекает через ${days} дн. (${fmtDate(until)})` : `${head}, до ${fmtDate(until)}`;
}
const fmtIso = (v: string | Date) => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));

const MAX = 20 * 1024 * 1024;
const ALLOWED = /\.(pdf|jpe?g|png|webp|heic|docx?|xlsx?|csv|txt|zip|rar|7z|odt|ods)$/i;

/** Сохранить загруженные файлы и привязать к объекту (договор, заказ…). Общая проверка размера и типа. */
export async function saveUploadedFiles(tx: Tx | typeof db, entityType: string, entityId: string, files: File[], userId: string) {
  for (const f of files) {
    if (f.size > MAX) throw new UserError(`«${f.name}» больше 20 МБ`);
    if (!ALLOWED.test(f.name)) throw new UserError(`Тип файла «${f.name}» не поддерживается`);
  }
  for (const f of files) {
    const key = `${entityType}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${path.extname(f.name).toLowerCase()}`;
    const stored = await putFile(key, Buffer.from(await f.arrayBuffer()), f.type);
    await tx.insert(schema.documents).values({ entityType, entityId, fileName: f.name, mimeType: f.type || "application/octet-stream", size: f.size, storagePath: stored, uploadedById: userId });
    await logActivity(tx, { userId, action: "upload", entityType, entityId, summary: `Загружен документ «${f.name}»` });
  }
}

export const formFiles = (fd: FormData, name = "file") => fd.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);

/**
 * Напоминание об окончании актуального договора — один раз, ответственным закупщикам и руководителям.
 * Вызывается при открытии страниц (как напоминания о задачах), отдельный планировщик не нужен.
 */
export async function ensureContractReminders() {
  await db.execute(sql`
    WITH due AS (
      UPDATE supplier_contracts c SET reminded_at = now()
      WHERE c.deleted_at IS NULL AND c.reminded_at IS NULL AND c.valid_until IS NOT NULL
        AND c.valid_until <= current_date + ${CONTRACT_WARN_DAYS}::int
        AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = c.supplier_id AND s.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM supplier_contracts n WHERE n.supplier_id = c.supplier_id AND n.deleted_at IS NULL AND n.id <> c.id
          AND (n.valid_until IS NULL OR n.valid_until > c.valid_until))
      RETURNING c.id, c.supplier_id, c.number, c.valid_until
    ),
    rcpt AS (
      SELECT due.*, sb.user_id FROM due JOIN supplier_buyers sb ON sb.supplier_id = due.supplier_id
      UNION
      SELECT due.*, u.id FROM due CROSS JOIN users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.is_active
    )
    INSERT INTO notifications (user_id, type, title, body, link)
    SELECT rcpt.user_id, 'contract_expiring',
      CASE WHEN rcpt.valid_until < current_date THEN 'Истёк договор с поставщиком' ELSE 'Скоро истекает договор с поставщиком' END,
      s.name || ': договор' || COALESCE(' № ' || rcpt.number, '') || ' действует до ' || to_char(rcpt.valid_until, 'DD.MM.YYYY'),
      '/suppliers/' || rcpt.supplier_id
    FROM rcpt JOIN suppliers s ON s.id = rcpt.supplier_id`);
}
