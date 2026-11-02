import { sql, type SQL } from "drizzle-orm";
import { qp, type SP } from "@/components/list";
import { today } from "@/lib/format";
import { OVERDUE_SQL } from "./orders";

/** Фильтры списка заказов из адресной строки (общие для страницы и экспорта в Excel) */
export function orderFilters(sp: SP): SQL[] {
  const w: SQL[] = [];
  const q = qp(sp, "q").trim();
  if (q) {
    const like = `%${q}%`;
    const n = Number(q.replace(/\D/g, ""));
    w.push(sql`(s.name ILIKE ${like} OR o.invoice_number ILIKE ${like} OR o.comment ILIKE ${like}
      OR EXISTS (SELECT 1 FROM purchase_order_items poi JOIN products pr ON pr.id = poi.product_id WHERE poi.order_id = o.id AND pr.name ILIKE ${like})
      ${n ? sql`OR o.number = ${n}` : sql``})`);
  }
  const st = qp(sp, "status");
  if (st === "active") w.push(sql`o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL')`);
  else if (st === "overdue") w.push(OVERDUE_SQL(today()));
  else if (st) w.push(sql`o.status = ${st}`);
  const sup = qp(sp, "supplier");
  if (sup) w.push(sql`o.supplier_id = ${sup}`);
  const buyer = qp(sp, "buyer");
  if (buyer === "none") w.push(sql`o.buyer_id IS NULL`);
  else if (buyer) w.push(sql`o.buyer_id = ${buyer}`);
  const legal = qp(sp, "legal");
  if (legal) w.push(sql`o.legal_entity_id = ${legal}`);
  const dir = qp(sp, "direction");
  if (dir) w.push(sql`(o.direction_id = ${dir} OR EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = o.id AND poi.direction_id = ${dir}))`);
  const product = qp(sp, "product");
  if (product) w.push(sql`EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = o.id AND poi.product_id = ${product})`);
  const from = qp(sp, "from");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) w.push(sql`o.order_date >= ${from}::date`);
  const to = qp(sp, "to");
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) w.push(sql`o.order_date <= ${to}::date`);
  return w;
}

export function orderSort(sp: SP): SQL {
  const dir = qp(sp, "dir") === "asc" ? sql`ASC` : sql`DESC`;
  switch (qp(sp, "sort")) {
    case "number":
      return sql`o.number ${dir}`;
    case "supplier":
      return sql`s.name ${dir}, o.number DESC`;
    case "amount":
      return sql`COALESCE(os.amount,0) ${dir}`;
    case "debt":
      return sql`COALESCE(os.amount,0) - COALESCE(ps.paid,0) ${dir}`;
    default:
      return sql`o.order_date ${dir}, o.number ${dir}`;
  }
}
