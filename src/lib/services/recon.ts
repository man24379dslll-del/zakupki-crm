import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { orderNo } from "@/lib/format";
import { buildAct, type ActDelivery, type ActPayment, type ActResult } from "@/lib/recon";
import { orderScope } from "./orders";

export interface ActData extends ActResult {
  supplier: { id: string; name: string; legalName: string | null; inn: string | null };
  legal: { id: string; name: string; inn: string | null } | null;
  contract: { number: string | null; date: string | null } | null;
  from: string;
  to: string;
  /** при выбранном юрлице: поставки/оплаты без юрлица в акт не вошли */
  withoutLegal: number;
}

const ymd = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

/** Юрлицо по умолчанию для акта — то, на которое чаще всего оформлены заказы этому поставщику */
export async function defaultLegal(supplierId: string): Promise<string | null> {
  const r = await db.execute(sql`SELECT legal_entity_id FROM purchase_orders WHERE supplier_id = ${supplierId} AND deleted_at IS NULL AND legal_entity_id IS NOT NULL
    GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
  return (r.rows[0] as { legal_entity_id: string } | undefined)?.legal_entity_id ?? null;
}

/** Данные акта сверки с теми же правами видимости, что в «Оплатах» (закупщик — только свои заказы) */
export async function loadAct(u: SessionUser, supplierId: string, legalId: string | null, from: string, to: string): Promise<ActData | null> {
  const [s] = (await db.execute(sql`SELECT id, name, legal_name, inn FROM suppliers WHERE id = ${supplierId} AND deleted_at IS NULL`)).rows as { id: string; name: string; legal_name: string | null; inn: string | null }[];
  if (!s) return null;
  const [legal] = legalId ? ((await db.execute(sql`SELECT id, name, inn FROM legal_entities WHERE id = ${legalId}`)).rows as { id: string; name: string; inn: string | null }[]) : [];
  const [contract] = (await db.execute(sql`SELECT number, date FROM supplier_contracts WHERE supplier_id = ${supplierId} AND deleted_at IS NULL
    ORDER BY valid_until DESC NULLS FIRST, date DESC NULLS LAST, created_at DESC LIMIT 1`)).rows as { number: string | null; date: unknown }[];
  const adv = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
  const legalD = legal ? sql`o.legal_entity_id = ${legal.id}` : sql`TRUE`;
  const legalP = legal ? sql`COALESCE(p.legal_entity_id, o.legal_entity_id) = ${legal.id}` : sql`TRUE`;
  const [dRes, iRes, pRes, noLegal] = await Promise.all([
    db.execute(sql`SELECT d.id, d.date, d.waybill_number, o.number FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id
      WHERE d.supplier_id = ${supplierId} AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND ${orderScope(u)} AND ${legalD} AND d.date <= ${to}::date`),
    db.execute(sql`SELECT di.delivery_id, pr.name, pr.unit, di.qty, COALESCE(di.price, poi.price) AS price
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id JOIN purchase_orders o ON o.id = d.order_id
      JOIN products pr ON pr.id = di.product_id LEFT JOIN purchase_order_items poi ON poi.id = di.order_item_id
      WHERE d.supplier_id = ${supplierId} AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND ${orderScope(u)} AND ${legalD} AND d.date BETWEEN ${from}::date AND ${to}::date
      ORDER BY pr.name`),
    db.execute(sql`SELECT p.id, p.date, p.doc_number, p.amount, o.number FROM payments p LEFT JOIN purchase_orders o ON o.id = p.order_id
      WHERE p.supplier_id = ${supplierId} AND p.deleted_at IS NULL
        AND ((p.order_id IS NOT NULL AND o.deleted_at IS NULL AND ${orderScope(u)}) OR (p.order_id IS NULL AND ${adv})) AND ${legalP}`),
    legal
      ? db.execute(sql`SELECT
          (SELECT count(*) FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id WHERE d.supplier_id = ${supplierId} AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND o.legal_entity_id IS NULL AND d.date <= ${to}::date)
        + (SELECT count(*) FROM payments p LEFT JOIN purchase_orders o ON o.id = p.order_id WHERE p.supplier_id = ${supplierId} AND p.deleted_at IS NULL AND COALESCE(p.legal_entity_id, o.legal_entity_id) IS NULL) AS n`)
      : Promise.resolve({ rows: [{ n: 0 }] }),
  ]);
  // для строк до начала периода нужна только сумма — берём её одним запросом без состава
  const before = (
    await db.execute(sql`SELECT d.id, SUM(di.qty * COALESCE(di.price, poi.price)) AS amount FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id
      JOIN delivery_items di ON di.delivery_id = d.id LEFT JOIN purchase_order_items poi ON poi.id = di.order_item_id
      WHERE d.supplier_id = ${supplierId} AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND ${orderScope(u)} AND ${legalD} AND d.date < ${from}::date GROUP BY d.id`)
  ).rows as { id: string; amount: string | null }[];
  const beforeSum = new Map(before.map((b) => [b.id, Number(b.amount ?? 0)]));
  const items = iRes.rows as { delivery_id: string; name: string; unit: string; qty: string; price: string | null }[];
  const deliveries: ActDelivery[] = (dRes.rows as { id: string; date: unknown; waybill_number: string | null; number: number }[]).map((d) => {
    const date = ymd(d.date)!;
    return {
      id: d.id,
      date,
      waybill: d.waybill_number,
      orderNo: orderNo(d.number),
      lines: date < from ? [{ name: "", unit: "", qty: 1, price: beforeSum.get(d.id) ?? 0 }] : items.filter((i) => i.delivery_id === d.id).map((i) => ({ name: i.name, unit: i.unit || "шт", qty: Number(i.qty), price: i.price === null ? null : Number(i.price) })),
    };
  });
  const payments: ActPayment[] = (pRes.rows as { id: string; date: unknown; doc_number: string | null; amount: string; number: number | null }[]).map((p) => ({
    id: p.id,
    date: ymd(p.date),
    doc: p.doc_number,
    amount: Number(p.amount),
    orderNo: p.number ? orderNo(p.number) : null,
  }));
  return {
    ...buildAct(deliveries, payments, from, to),
    supplier: { id: s.id, name: s.name, legalName: s.legal_name, inn: s.inn },
    legal: legal ?? null,
    contract: contract ? { number: contract.number, date: ymd(contract.date) } : null,
    from,
    to,
    withoutLegal: Number((noLegal.rows[0] as { n: number | string }).n),
  };
}
