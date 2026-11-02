import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { orderScope, ORDER_STATS } from "./orders";

export interface SupplierStatsRow {
  id: string;
  name: string;
  status: string;
  inn: string | null;
  activity: string | null;
  buyers: string | null;
  buyer_ids: string[] | null;
  orders: number;
  active_orders: number;
  amount: string;
  delivered_amount: string;
  paid_orders: string;
  advances: string;
  last_order: string | null;
  total?: number;
}

/**
 * Поставщики со сводкой. Финансовые показатели считаются только по заказам, которые видит пользователь;
 * авансы без счёта — для руководителя и ответственных закупщиков.
 */
export async function supplierList(u: SessionUser, where: SQL[] = [], order: SQL = sql`s.name`, limit = 1000, offset = 0) {
  const advScope = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
  const res = await db.execute(sql`
    WITH ${ORDER_STATS},
    o AS (
      SELECT o.supplier_id, COUNT(*) AS orders,
        COUNT(*) FILTER (WHERE o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL')) AS active_orders,
        SUM(COALESCE(os.amount,0)) FILTER (WHERE o.status <> 'CANCELLED') AS amount,
        SUM(COALESCE(os.delivered_amount,0)) AS delivered_amount,
        SUM(COALESCE(ps.paid,0)) AS paid_orders,
        MAX(o.order_date) AS last_order
      FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN pay_stats ps ON ps.order_id = o.id
      WHERE o.deleted_at IS NULL AND ${orderScope(u)}
      GROUP BY o.supplier_id
    ),
    adv AS (SELECT p.supplier_id, SUM(p.amount) AS advances FROM payments p WHERE p.order_id IS NULL AND p.deleted_at IS NULL AND ${advScope} GROUP BY p.supplier_id)
    SELECT s.id, s.name, s.status, s.inn, s.activity,
      (SELECT string_agg(u.name, ', ') FROM supplier_buyers sb JOIN users u ON u.id = sb.user_id WHERE sb.supplier_id = s.id) AS buyers,
      (SELECT array_agg(sb.user_id::text) FROM supplier_buyers sb WHERE sb.supplier_id = s.id) AS buyer_ids,
      COALESCE(o.orders,0)::int AS orders, COALESCE(o.active_orders,0)::int AS active_orders,
      COALESCE(o.amount,0) AS amount, COALESCE(o.delivered_amount,0) AS delivered_amount,
      COALESCE(o.paid_orders,0) AS paid_orders, COALESCE(adv.advances,0) AS advances, o.last_order,
      COUNT(*) OVER()::int AS total
    FROM suppliers s LEFT JOIN o ON o.supplier_id = s.id LEFT JOIN adv ON adv.supplier_id = s.id
    WHERE s.deleted_at IS NULL ${where.length ? sql`AND ${sql.join(where, sql` AND `)}` : sql``}
    ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
  return res.rows as unknown as SupplierStatsRow[];
}
