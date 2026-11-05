import "server-only";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { AccessError } from "@/lib/auth";
import { num, today } from "@/lib/format";
import { computeStatus, type ItemProgress } from "@/lib/calc";
export { computeStatus, checkOverDelivery } from "@/lib/calc";

/**
 * Агрегаты по позициям/заказам считаются в SQL из первичных записей (позиции, поставки, оплаты).
 * Ничего производного не хранится — расхождений «как в Excel» быть не может.
 */
/** due_date — срок позиции: свой (poi.planned_delivery_date) или общий срок заказа */
export const ITEM_STATS = sql`
  item_stats AS (
    SELECT poi.id, poi.order_id, poi.product_id, poi.qty, poi.price, poi.is_closed,
      COALESCE(poi.planned_delivery_date, po.planned_delivery_date) AS due_date,
      COALESCE(SUM(di.qty) FILTER (WHERE d.id IS NOT NULL), 0) AS delivered,
      COALESCE(SUM(di.qty * COALESCE(di.price, poi.price)) FILTER (WHERE d.id IS NOT NULL), 0) AS delivered_amount,
      MAX(d.date) AS last_delivery
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.order_id
    LEFT JOIN delivery_items di ON di.order_item_id = poi.id
    LEFT JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
    GROUP BY poi.id, po.planned_delivery_date
  )`;

export const ORDER_STATS = sql`
  ${ITEM_STATS},
  order_stats AS (
    SELECT order_id,
      SUM(qty * COALESCE(price, 0)) AS amount,
      SUM(qty) AS qty,
      SUM(delivered) AS delivered,
      SUM(delivered_amount) AS delivered_amount,
      SUM(CASE WHEN is_closed THEN 0 ELSE GREATEST(qty - delivered, 0) END) AS remaining,
      BOOL_OR(price IS NULL) AS has_null_price,
      COUNT(*) AS items_count,
      MAX(last_delivery) AS last_delivery,
      -- ближайший срок среди ещё не пришедших позиций: по нему считаются просрочки
      MIN(due_date) FILTER (WHERE NOT is_closed AND qty > delivered) AS next_due
    FROM item_stats GROUP BY order_id
  ),
  pay_stats AS (
    SELECT order_id, SUM(amount) AS paid, MAX(date) AS last_payment
    FROM payments WHERE deleted_at IS NULL AND order_id IS NOT NULL GROUP BY order_id
  )`;

export interface OrderRow {
  id: string;
  number: number;
  order_date: string;
  status: string;
  invoice_number: string | null;
  planned_delivery_date: string | null;
  payment_method: string | null;
  cash_planned: string | null;
  supplier_id: string;
  supplier_name: string;
  buyer_id: string | null;
  buyer_name: string | null;
  legal_entity_name: string | null;
  direction_name: string | null;
  amount: string;
  qty: string;
  delivered: string;
  delivered_amount: string;
  remaining: string;
  paid: string;
  items_count: number;
  has_null_price: boolean;
  last_delivery: string | null;
  products: string | null;
  overdue: boolean;
  total_count?: number;
}

/** Условие видимости заказов для пользователя (проверка на сервере) */
export function orderScope(u: SessionUser, alias = "o"): SQL {
  if (can(u, PERMS.ordersViewAll)) return sql`TRUE`;
  return sql`${sql.raw(alias)}.buyer_id = ${u.id}`;
}

/** Заказ просрочен, если срок хотя бы одной недопоставленной позиции (свой или общий) прошёл */
export const OVERDUE_SQL = (d: string) => sql`(o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') AND COALESCE(os.next_due < ${d}::date, false))`;

export interface OrderListParams {
  where?: SQL[];
  orderBy?: SQL;
  limit?: number;
  offset?: number;
}

export async function listOrders(u: SessionUser, p: OrderListParams = {}): Promise<OrderRow[]> {
  const d = today();
  const conds = [sql`o.deleted_at IS NULL`, orderScope(u), ...(p.where ?? [])];
  const res = await db.execute(sql`
    WITH ${ORDER_STATS}
    SELECT o.id, o.number, o.order_date, o.status, o.invoice_number, o.planned_delivery_date, o.payment_method, o.cash_planned,
      o.supplier_id, s.name AS supplier_name, o.buyer_id, u.name AS buyer_name,
      COALESCE(le.short_name, le.name) AS legal_entity_name, dir.name AS direction_name,
      COALESCE(os.amount,0) AS amount, COALESCE(os.qty,0) AS qty, COALESCE(os.delivered,0) AS delivered,
      COALESCE(os.delivered_amount,0) AS delivered_amount, COALESCE(os.remaining,0) AS remaining,
      COALESCE(ps.paid,0) AS paid, COALESCE(os.items_count,0)::int AS items_count, COALESCE(os.has_null_price,false) AS has_null_price,
      os.last_delivery,
      (SELECT string_agg(pr.name, ', ' ORDER BY poi.sort_order) FROM purchase_order_items poi JOIN products pr ON pr.id = poi.product_id WHERE poi.order_id = o.id) AS products,
      ${OVERDUE_SQL(d)} AS overdue,
      COUNT(*) OVER()::int AS total_count
    FROM purchase_orders o
    JOIN suppliers s ON s.id = o.supplier_id
    LEFT JOIN users u ON u.id = o.buyer_id
    LEFT JOIN legal_entities le ON le.id = o.legal_entity_id
    LEFT JOIN directions dir ON dir.id = o.direction_id
    LEFT JOIN order_stats os ON os.order_id = o.id
    LEFT JOIN pay_stats ps ON ps.order_id = o.id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ${p.orderBy ?? sql`o.order_date DESC, o.number DESC`}
    ${p.limit ? sql`LIMIT ${p.limit}` : sql``} ${p.offset ? sql`OFFSET ${p.offset}` : sql``}
  `);
  return res.rows as unknown as OrderRow[];
}

/** Доступ к конкретному заказу: закупщик — только к своим (если нет права «видеть все») */
export async function assertOrderAccess(u: SessionUser, orderId: string, write = false) {
  const [o] = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, orderId), isNull(schema.purchaseOrders.deletedAt)));
  if (!o) throw new AccessError("Заказ не найден");
  if (!can(u, PERMS.ordersViewAll) && o.buyerId !== u.id) throw new AccessError("Это заказ другого закупщика");
  if (write && !can(u, PERMS.ordersEdit)) throw new AccessError();
  return o;
}

export async function itemProgress(tx: Tx | typeof db, orderIds: string[]): Promise<(ItemProgress & { orderId: string; productId: string; price: number | null; overDeliveryApproved: boolean })[]> {
  if (!orderIds.length) return [];
  const res = await tx.execute(sql`
    SELECT poi.id, poi.order_id, poi.product_id, poi.qty, poi.price, poi.is_closed, poi.over_delivery_approved,
      COALESCE(SUM(di.qty) FILTER (WHERE d.id IS NOT NULL), 0) AS delivered
    FROM purchase_order_items poi
    LEFT JOIN delivery_items di ON di.order_item_id = poi.id
    LEFT JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
    WHERE poi.order_id IN (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)})
    GROUP BY poi.id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    orderId: r.order_id as string,
    productId: r.product_id as string,
    qty: Number(r.qty),
    price: num(r.price),
    delivered: Number(r.delivered),
    isClosed: r.is_closed as boolean,
    overDeliveryApproved: r.over_delivery_approved as boolean,
  }));
}

/** Пересчитать статус заказа после изменения позиций/поставок. Возвращает [было, стало]. */
export async function recalcOrderStatus(tx: Tx, orderId: string): Promise<[string, string]> {
  const [o] = await tx.select({ status: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId));
  const items = await itemProgress(tx, [orderId]);
  const next = computeStatus(o.status, items);
  if (next !== o.status) {
    await tx.update(schema.purchaseOrders).set({ status: next as typeof o.status, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, orderId));
  }
  return [o.status, next];
}

export async function recalcMany(tx: Tx, orderIds: string[]) {
  for (const id of orderIds) await recalcOrderStatus(tx, id);
}

export async function orderIdsOfSupplierVisible(u: SessionUser, supplierId: string) {
  const rows = await db
    .select({ id: schema.purchaseOrders.id })
    .from(schema.purchaseOrders)
    .where(
      and(
        eq(schema.purchaseOrders.supplierId, supplierId),
        isNull(schema.purchaseOrders.deletedAt),
        can(u, PERMS.ordersViewAll) ? undefined : eq(schema.purchaseOrders.buyerId, u.id),
      ),
    );
  return rows.map((r) => r.id);
}

void inArray;
