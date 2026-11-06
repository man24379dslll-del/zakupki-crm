import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { num } from "@/lib/format";
import type { DeliveryLine } from "@/lib/history";

/** дата из БД: строка «ГГГГ-ММ-ДД» или Date — приводим к строке */
const ymd = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

export type LogDetail =
  | { kind: "delivery"; id: string; orderId: string; date: string; waybill: string | null; comment: string | null; dateAssumed: boolean; deleted: boolean; lines: DeliveryLine[] }
  | { kind: "payment"; id: string; orderId: string | null; date: string | null; amount: number; method: string; type: string; docNumber: string | null; comment: string | null; legal: string | null; deleted: boolean };

/**
 * Состав поставки или оплаты для записей истории. Запись о поставке в карточке заказа хранит только общее число,
 * поэтому поставку находим по заказу и времени записи (поставка и запись создаются в одной транзакции —
 * время совпадает); у записей самой поставки/оплаты — по id. Так раскрываются и старые записи.
 */
export async function loadLogDetails(logIds: string[]): Promise<Map<string, LogDetail>> {
  const out = new Map<string, LogDetail>();
  if (!logIds.length) return out;
  const ids = sql.raw(`ARRAY[${logIds.map((x) => `'${x.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]`);
  const near = (t: string) => sql.raw(`abs(extract(epoch FROM ${t}.created_at - l.created_at))`);
  const [dRes, pRes] = await Promise.all([
    db.execute(sql`SELECT l.id AS log_id, d.id, d.order_id, d.date, d.waybill_number, d.comment, d.date_assumed, d.deleted_at IS NOT NULL AS deleted
      FROM activity_logs l
      JOIN LATERAL (
        SELECT d.* FROM deliveries d
        WHERE (l.entity_type = 'delivery' AND d.id::text = l.entity_id)
           OR (l.entity_type = 'order' AND d.order_id::text = l.entity_id AND ${near("d")} < 5)
        ORDER BY ${near("d")} LIMIT 1) d ON true
      WHERE l.id = ANY(${ids}) AND ((l.entity_type = 'delivery' AND l.action = 'create') OR (l.entity_type = 'order' AND l.action = 'delivery'))`),
    db.execute(sql`SELECT l.id AS log_id, p.id, p.order_id, p.date, p.amount, p.method, p.type, p.doc_number, p.comment, p.deleted_at IS NOT NULL AS deleted,
        COALESCE(le.short_name, le.name) AS legal
      FROM activity_logs l
      JOIN LATERAL (
        SELECT p.* FROM payments p
        WHERE (l.entity_type = 'payment' AND p.id::text = l.entity_id)
           OR (l.entity_type = 'order' AND p.order_id::text = l.entity_id AND ${near("p")} < 5)
        ORDER BY ${near("p")} LIMIT 1) p ON true
      LEFT JOIN legal_entities le ON le.id = p.legal_entity_id
      WHERE l.id = ANY(${ids}) AND ((l.entity_type = 'payment' AND l.action = 'create') OR (l.entity_type = 'order' AND l.action = 'payment'))`),
  ]);
  const dRows = dRes.rows as { log_id: string; id: string; order_id: string; date: string; waybill_number: string | null; comment: string | null; date_assumed: boolean; deleted: boolean }[];
  if (dRows.length) {
    const dIds = sql.raw(`ARRAY[${[...new Set(dRows.map((r) => `'${r.id}'`))].join(",")}]::uuid[]`);
    const items = (
      await db.execute(sql`SELECT di.delivery_id, pr.name, pr.unit, di.qty, di.price FROM delivery_items di JOIN products pr ON pr.id = di.product_id
        WHERE di.delivery_id = ANY(${dIds}) ORDER BY pr.name`)
    ).rows as { delivery_id: string; name: string; unit: string; qty: string; price: string | null }[];
    for (const r of dRows)
      out.set(r.log_id, {
        kind: "delivery",
        id: r.id,
        orderId: r.order_id,
        date: ymd(r.date) ?? "",
        waybill: r.waybill_number,
        comment: r.comment,
        dateAssumed: r.date_assumed,
        deleted: r.deleted,
        lines: items.filter((i) => i.delivery_id === r.id).map((i) => ({ name: i.name, unit: i.unit || "шт", qty: Number(i.qty), price: num(i.price) })),
      });
  }
  for (const r of pRes.rows as { log_id: string; id: string; order_id: string | null; date: string | null; amount: string; method: string; type: string; doc_number: string | null; comment: string | null; legal: string | null; deleted: boolean }[])
    out.set(r.log_id, { kind: "payment", id: r.id, orderId: r.order_id, date: ymd(r.date), amount: Number(r.amount), method: r.method, type: r.type, docNumber: r.doc_number, comment: r.comment, legal: r.legal, deleted: r.deleted });
  return out;
}
