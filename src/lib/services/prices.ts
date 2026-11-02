import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { num } from "@/lib/format";
import { compareSuppliers, lastAndPrev, monthlySeries, priceWindow, weightedStats, type PricePoint, type PriceStats, type WindowMode } from "@/lib/calc";
export { compareSuppliers, monthlySeries, priceWindow, weightedStats };
export type { PricePoint, WindowMode };

/**
 * Средневзвешенная закупочная цена:
 *   Σ(фактически поставленное кол-во × цена поставки) / Σ(кол-во)
 * - дата = дата фактической поставки;
 * - только непомеченные удалёнными поставки по неотменённым заказам;
 * - цена = фактическая цена поставки (если не указана — цена позиции заказа);
 * - строки без цены не участвуют (не подменяются нулём);
 * - строки с условным количеством (excludeFromPrice) не участвуют.
 */


export async function getWindowMode(): Promise<WindowMode> {
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.key, "priceWindowMode"));
  return (s?.value as WindowMode) ?? "rolling";
}


/** Все фактические ценовые точки товара (по поставкам), по возрастанию даты */
export async function pricePoints(productIds: string[], from?: string, to?: string): Promise<(PricePoint & { productId: string })[]> {
  if (!productIds.length) return [];
  const res = await db.execute(sql`
    SELECT di.product_id, d.date::text AS date, di.qty, COALESCE(di.price, poi.price) AS price,
      o.supplier_id, s.name AS supplier_name, o.id AS order_id, o.number AS order_number
    FROM delivery_items di
    JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
    JOIN purchase_order_items poi ON poi.id = di.order_item_id
    JOIN purchase_orders o ON o.id = poi.order_id AND o.deleted_at IS NULL AND o.status <> 'CANCELLED'
    JOIN suppliers s ON s.id = o.supplier_id
    WHERE di.product_id IN (${sql.join(productIds.map((p) => sql`${p}`), sql`, `)})
      AND di.exclude_from_price = false
      AND COALESCE(di.price, poi.price) IS NOT NULL
      AND di.qty > 0
      ${from ? sql`AND d.date >= ${from}::date` : sql``}
      ${to ? sql`AND d.date <= ${to}::date` : sql``}
    ORDER BY d.date, o.number`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    productId: r.product_id as string,
    date: r.date as string,
    qty: Number(r.qty),
    price: Number(r.price),
    supplierId: r.supplier_id as string,
    supplierName: r.supplier_name as string,
    orderId: r.order_id as string,
    orderNumber: Number(r.order_number),
  }));
}

export interface ProductPriceCard extends PriceStats {
  lastPrice: number | null;
  lastDate: string | null;
  prevPrice: number | null;
  change: number | null; // % к предыдущей закупке
  totalQty: number; // за всё время
  totalAmount: number;
  window: { from: string; to: string };
}

export async function productPriceCard(productId: string, months = 6): Promise<ProductPriceCard> {
  const mode = await getWindowMode();
  const w = priceWindow(months, mode);
  const all = await pricePoints([productId]);
  const inWin = all.filter((p) => p.date >= w.from && p.date <= w.to);
  const s = weightedStats(inWin);
  const total = weightedStats(all);
  return { ...s, ...lastAndPrev(all), totalQty: total.qty, totalAmount: total.amount, window: w };
}

/** Сводка средних цен по всем товарам (для списка товаров и аналитики) */
export async function allProductsAvg(months = 6) {
  const mode = await getWindowMode();
  const w = priceWindow(months, mode);
  const res = await db.execute(sql`
    SELECT di.product_id,
      SUM(di.qty * COALESCE(di.price, poi.price)) / NULLIF(SUM(di.qty),0) AS avg,
      SUM(di.qty) AS qty
    FROM delivery_items di
    JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
    JOIN purchase_order_items poi ON poi.id = di.order_item_id
    JOIN purchase_orders o ON o.id = poi.order_id AND o.deleted_at IS NULL AND o.status <> 'CANCELLED'
    WHERE di.exclude_from_price = false AND COALESCE(di.price, poi.price) IS NOT NULL AND di.qty > 0
      AND d.date BETWEEN ${w.from}::date AND ${w.to}::date
    GROUP BY di.product_id`);
  const m = new Map<string, { avg: number | null; qty: number }>();
  for (const r of res.rows as Record<string, unknown>[]) m.set(r.product_id as string, { avg: num(r.avg), qty: Number(r.qty) });
  return { map: m, window: w };
}
