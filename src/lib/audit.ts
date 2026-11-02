import { db, schema, type Tx } from "@/db";

export type Changes = Record<string, [unknown, unknown]>;

/** Сравнивает объект до/после и возвращает только изменённые поля */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, labels?: Record<string, string>): Changes {
  const out: Changes = {};
  for (const k of Object.keys(after)) {
    const a = norm(before[k]);
    const b = norm(after[k]);
    if (a !== b) out[labels?.[k] ?? k] = [before[k] ?? null, after[k] ?? null];
  }
  return out;
}

function norm(v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v));
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export async function logActivity(
  tx: Tx | typeof db,
  e: { userId: string | null; action: string; entityType: string; entityId: string; summary: string; changes?: Changes | null; ip?: string | null },
) {
  await tx.insert(schema.activityLogs).values({
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    changes: e.changes && Object.keys(e.changes).length ? e.changes : null,
    ip: e.ip ?? null,
  });
}

export async function notify(tx: Tx | typeof db, n: { userId: string; type: string; title: string; body?: string; link?: string }) {
  await tx.insert(schema.notifications).values(n);
}
