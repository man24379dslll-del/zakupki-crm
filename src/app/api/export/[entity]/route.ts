import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { listOrders, orderScope } from "@/lib/services/orders";
import { orderFilters, orderSort } from "@/lib/services/order-filters";
import { supplierList } from "@/lib/services/suppliers";
import { allProductsAvg } from "@/lib/services/prices";
import { ORDER_STATUS_LABEL, PAYMENT_TYPE_LABEL, SUPPLIER_STATUS_LABEL, today, orderNo } from "@/lib/format";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";
import type { SP } from "@/components/list";

/** Экспорт таблиц в Excel с теми же фильтрами и правами, что на странице */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Требуется вход", { status: 401 });
  const { entity } = await params;
  const sp: SP = Object.fromEntries(new URL(req.url).searchParams);
  const q = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const d = today();

  if (entity === "orders") {
    const rows = await listOrders(u, { where: orderFilters(sp), orderBy: orderSort(sp), limit: 20000 });
    const buf = await buildXlsx([{
      name: "Заказы",
      columns: [
        { header: "№", key: "no" }, { header: "Дата", key: "order_date", fmt: "date" }, { header: "Поставщик", key: "supplier_name", width: 36 }, { header: "Счёт", key: "invoice_number" },
        { header: "Юрлицо", key: "legal_entity_name", width: 30 }, { header: "Направление", key: "direction_name" }, { header: "Закупщик", key: "buyer_name", width: 20 }, { header: "Товары", key: "products", width: 50 },
        { header: "Кол-во", key: "qty", fmt: "qty" }, { header: "Сумма", key: "amount", fmt: "money" }, { header: "Поставлено, шт", key: "delivered", fmt: "qty" }, { header: "Сумма отгрузок", key: "delivered_amount", fmt: "money" },
        { header: "Остаток, шт", key: "remaining", fmt: "qty" }, { header: "Оплачено", key: "paid", fmt: "money" }, { header: "Долг по заказу", key: "debt_order", fmt: "money" }, { header: "Долг по отгрузке", key: "debt_ship", fmt: "money" },
        { header: "План. поставка", key: "planned_delivery_date", fmt: "date" }, { header: "Статус", key: "status_label", width: 22 }, { header: "Просрочен", key: "overdue_label" },
      ],
      rows: rows.map((r) => ({ ...r, no: orderNo(r.number), debt_order: Number(r.amount) - Number(r.paid), debt_ship: Number(r.delivered_amount) - Number(r.paid), status_label: ORDER_STATUS_LABEL[r.status], overdue_label: r.overdue ? "да" : "" })),
    }]);
    return xlsxResponse(buf, `Заказы ${d}.xlsx`);
  }

  if (entity === "deliveries") {
    const w = [sql`d.deleted_at IS NULL`, sql`o.deleted_at IS NULL`, orderScope(u)];
    if (q("supplier")) w.push(sql`d.supplier_id = ${q("supplier")}`);
    if (q("product")) w.push(sql`di.product_id = ${q("product")}`);
    if (q("buyer")) w.push(sql`o.buyer_id = ${q("buyer")}`);
    if (q("from")) w.push(sql`d.date >= ${q("from")}::date`);
    if (q("to")) w.push(sql`d.date <= ${q("to")}::date`);
    const res = await db.execute(sql`SELECT d.date, 'З-' || lpad(o.number::text,5,'0') AS no, o.invoice_number, s.name AS supplier, pr.name AS product, di.qty, di.price, di.qty * di.price AS amount, d.waybill_number, CASE WHEN d.date_assumed THEN 'условная' END AS assumed, u.name AS who
      FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id JOIN products pr ON pr.id = di.product_id JOIN purchase_orders o ON o.id = d.order_id JOIN suppliers s ON s.id = d.supplier_id LEFT JOIN users u ON u.id = d.created_by_id
      WHERE ${sql.join(w, sql` AND `)} ORDER BY d.date DESC`);
    const buf = await buildXlsx([{ name: "Поставки", columns: [{ header: "Дата поставки", key: "date", fmt: "date" }, { header: "Заказ", key: "no" }, { header: "Счёт", key: "invoice_number" }, { header: "Поставщик", key: "supplier", width: 36 }, { header: "Товар", key: "product", width: 40 }, { header: "Кол-во", key: "qty", fmt: "qty" }, { header: "Цена", key: "price", fmt: "price" }, { header: "Сумма", key: "amount", fmt: "money" }, { header: "Накладная", key: "waybill_number" }, { header: "Дата", key: "assumed" }, { header: "Кто", key: "who" }], rows: res.rows as Record<string, unknown>[] }]);
    return xlsxResponse(buf, `Поставки ${d}.xlsx`);
  }

  if (entity === "payments") {
    const adv = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
    const w = [sql`p.deleted_at IS NULL`, sql`((p.order_id IS NOT NULL AND o.deleted_at IS NULL AND ${orderScope(u)}) OR (p.order_id IS NULL AND ${adv}))`];
    if (q("supplier")) w.push(sql`p.supplier_id = ${q("supplier")}`);
    if (q("from")) w.push(sql`p.date >= ${q("from")}::date`);
    if (q("to")) w.push(sql`p.date <= ${q("to")}::date`);
    const res = await db.execute(sql`SELECT p.date, s.name AS supplier, CASE WHEN o.id IS NULL THEN 'аванс без счёта' ELSE 'З-' || lpad(o.number::text,5,'0') END AS no, o.invoice_number, p.type, p.amount, p.doc_number, le.name AS legal, p.comment
      FROM payments p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN purchase_orders o ON o.id = p.order_id LEFT JOIN legal_entities le ON le.id = p.legal_entity_id WHERE ${sql.join(w, sql` AND `)} ORDER BY p.date DESC NULLS FIRST`);
    const rows = (res.rows as Record<string, unknown>[]).map((r) => ({ ...r, type: PAYMENT_TYPE_LABEL[r.type as string] }));
    const buf = await buildXlsx([{ name: "Оплаты", columns: [{ header: "Дата", key: "date", fmt: "date" }, { header: "Поставщик", key: "supplier", width: 36 }, { header: "Заказ", key: "no" }, { header: "Счёт", key: "invoice_number" }, { header: "Тип", key: "type" }, { header: "Сумма", key: "amount", fmt: "money" }, { header: "№ ПП", key: "doc_number" }, { header: "Плательщик", key: "legal", width: 30 }, { header: "Комментарий", key: "comment", width: 50 }], rows }]);
    return xlsxResponse(buf, `Оплаты ${d}.xlsx`);
  }

  if (entity === "suppliers") {
    const rows = await supplierList(u);
    const buf = await buildXlsx([{ name: "Поставщики", columns: [{ header: "Поставщик", key: "name", width: 40 }, { header: "ИНН", key: "inn" }, { header: "Статус", key: "st" }, { header: "Ответственные", key: "buyers", width: 30 }, { header: "Заказов", key: "orders" }, { header: "Объём закупок", key: "amount", fmt: "money" }, { header: "Поставлено", key: "delivered_amount", fmt: "money" }, { header: "Оплачено по заказам", key: "paid_orders", fmt: "money" }, { header: "Авансы без счёта", key: "advances", fmt: "money" }, { header: "Долг по отгрузке", key: "debt", fmt: "money" }, { header: "Последний заказ", key: "last_order", fmt: "date" }], rows: rows.map((r) => ({ ...r, st: SUPPLIER_STATUS_LABEL[r.status], debt: Number(r.delivered_amount) - Number(r.paid_orders) - Number(r.advances) })) }]);
    return xlsxResponse(buf, `Поставщики ${d}.xlsx`);
  }

  if (entity === "products") {
    const avg = await allProductsAvg(6);
    const res = await db.execute(sql`SELECT p.id, p.name, p.sku, p.category, p.unit, (SELECT string_agg(s.name, ', ') FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE ps.product_id = p.id) AS suppliers FROM products p WHERE p.merged_into_id IS NULL ORDER BY p.name`);
    const rows = (res.rows as Record<string, unknown>[]).map((r) => ({ ...r, avg: avg.map.get(r.id as string)?.avg ?? null, qty6: avg.map.get(r.id as string)?.qty ?? null }));
    const buf = await buildXlsx([{ name: "Товары", columns: [{ header: "Товар", key: "name", width: 44 }, { header: "Артикул", key: "sku" }, { header: "Категория", key: "category" }, { header: "Ед.", key: "unit" }, { header: "Поставщики", key: "suppliers", width: 40 }, { header: `Средневзв. цена ${avg.window.from}…${avg.window.to}`, key: "avg", fmt: "price", width: 26 }, { header: "Поставлено за 6 мес.", key: "qty6", fmt: "qty" }], rows }]);
    return xlsxResponse(buf, `Товары ${d}.xlsx`);
  }

  if (entity === "analytics") {
    if (!can(u, PERMS.statsViewAll)) return new Response("Нет доступа", { status: 403 });
    const rows = await listOrders(u, { where: orderFilters(sp), limit: 20000 });
    const by = (k: "supplier_name" | "buyer_name") => {
      const m = new Map<string, { name: string; orders: number; amount: number; delivered: number; paid: number; overdue: number }>();
      for (const r of rows) {
        const name = r[k] ?? "Не назначен";
        const x = m.get(name) ?? { name, orders: 0, amount: 0, delivered: 0, paid: 0, overdue: 0 };
        x.orders++; x.amount += Number(r.amount); x.delivered += Number(r.delivered_amount); x.paid += Number(r.paid); x.overdue += r.overdue ? 1 : 0;
        m.set(name, x);
      }
      return [...m.values()].sort((a, b) => b.amount - a.amount);
    };
    const cols = [{ header: "Название", key: "name", width: 40 }, { header: "Заказов", key: "orders" }, { header: "Сумма заказов", key: "amount", fmt: "money" as const }, { header: "Поставлено", key: "delivered", fmt: "money" as const }, { header: "Оплачено", key: "paid", fmt: "money" as const }, { header: "Просроч. поставок", key: "overdue" }];
    const buf = await buildXlsx([{ name: "По поставщикам", columns: cols, rows: by("supplier_name") as never }, { name: "По закупщикам", columns: cols, rows: by("buyer_name") as never }]);
    return xlsxResponse(buf, `Аналитика ${d}.xlsx`);
  }
  return new Response("Неизвестный раздел", { status: 404 });
}
