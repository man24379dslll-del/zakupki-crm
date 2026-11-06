import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { logActivity } from "@/lib/audit";
import { fmtDate, fmtMoney, orderNo } from "@/lib/format";
import { deliveryHeadline } from "@/lib/history";
import { recalcOrderStatus } from "./orders";

/**
 * «Отменить действия сотрудника за день» (Настройки → Журнал действий).
 * Мягко удаляет то, что сотрудник СОЗДАЛ в этот день: заказы, поставки, оплаты, документы, задачи.
 * Правки в чужих записях не откатываются — они показываются отдельным списком, их проверяют вручную.
 * Всё удалённое можно вернуть в Настройки → «Удалённые»; статусы заказов пересчитываются.
 */
export interface UndoPlan {
  user: { id: string; name: string };
  day: string;
  orders: { id: string; label: string }[];
  deliveries: { id: string; orderId: string; label: string; order: string }[];
  payments: { id: string; orderId: string | null; label: string }[];
  documents: { id: string; entityType: string; entityId: string; label: string }[];
  tasks: { id: string; label: string }[];
  /** правки, которые не отменяются автоматически */
  edits: { at: string; summary: string }[];
}

const DAY = (col: string, day: string) => sql.raw(`(${col} AT TIME ZONE 'Europe/Moscow')::date = '${day.replace(/[^0-9-]/g, "")}'::date`);

export async function undoPlan(userId: string, day: string, tx: Tx | typeof db = db): Promise<UndoPlan | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [u] = (await tx.execute(sql`SELECT id, name FROM users WHERE id = ${userId}`)).rows as { id: string; name: string }[];
  if (!u) return null;
  const [orders, deliveries, items, payments, documents, tasks, edits] = await Promise.all([
    tx.execute(sql`SELECT o.id, o.number, s.name AS supplier FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.created_by_id = ${userId} AND o.deleted_at IS NULL AND ${DAY("o.created_at", day)} ORDER BY o.number`),
    tx.execute(sql`SELECT d.id, d.order_id, d.date, d.waybill_number, o.number FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id
      WHERE d.created_by_id = ${userId} AND d.deleted_at IS NULL AND ${DAY("d.created_at", day)} ORDER BY d.created_at`),
    tx.execute(sql`SELECT di.delivery_id, pr.name, pr.unit, di.qty, di.price FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id JOIN products pr ON pr.id = di.product_id
      WHERE d.created_by_id = ${userId} AND d.deleted_at IS NULL AND ${DAY("d.created_at", day)} ORDER BY pr.name`),
    tx.execute(sql`SELECT p.id, p.order_id, p.amount, p.date, s.name AS supplier FROM payments p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.created_by_id = ${userId} AND p.deleted_at IS NULL AND ${DAY("p.created_at", day)} ORDER BY p.created_at`),
    tx.execute(sql`SELECT d.id, d.entity_type, d.entity_id, d.file_name, o.number FROM documents d LEFT JOIN purchase_orders o ON d.entity_type = 'order' AND o.id = d.entity_id
      WHERE d.uploaded_by_id = ${userId} AND d.deleted_at IS NULL AND ${DAY("d.created_at", day)} ORDER BY d.created_at`),
    tx.execute(sql`SELECT t.id, t.title FROM tasks t WHERE t.creator_id = ${userId} AND t.deleted_at IS NULL AND ${DAY("t.created_at", day)} ORDER BY t.created_at`),
    tx.execute(sql`SELECT to_char(l.created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS at, l.summary FROM activity_logs l
      WHERE l.user_id = ${userId} AND l.action = 'update' AND ${DAY("l.created_at", day)} ORDER BY l.created_at`),
  ]);
  const its = items.rows as { delivery_id: string; name: string; unit: string; qty: string; price: string | null }[];
  return {
    user: u,
    day,
    orders: (orders.rows as { id: string; number: number; supplier: string }[]).map((o) => ({ id: o.id, label: `${orderNo(o.number)} · ${o.supplier}` })),
    deliveries: (deliveries.rows as { id: string; order_id: string; date: string; waybill_number: string | null; number: number }[]).map((d) => ({
      id: d.id,
      orderId: d.order_id,
      order: orderNo(d.number),
      label: deliveryHeadline(
        typeof d.date === "string" ? d.date : fmtIso(d.date),
        its.filter((i) => i.delivery_id === d.id).map((i) => ({ name: i.name, unit: i.unit || "шт", qty: Number(i.qty), price: i.price === null ? null : Number(i.price) })),
      ) + (d.waybill_number ? ` · накладная ${d.waybill_number}` : ""),
    })),
    payments: (payments.rows as { id: string; order_id: string | null; amount: string; date: string | null; supplier: string }[]).map((p) => ({
      id: p.id,
      orderId: p.order_id,
      label: `Оплата ${fmtMoney(p.amount)}${p.date ? ` от ${fmtDate(p.date)}` : ""} · ${p.supplier}${p.order_id ? "" : " (аванс без счёта)"}`,
    })),
    documents: (documents.rows as { id: string; entity_type: string; entity_id: string; file_name: string; number: number | null }[]).map((d) => ({
      id: d.id,
      entityType: d.entity_type,
      entityId: d.entity_id,
      label: `${d.file_name}${d.number ? ` · заказ ${orderNo(d.number)}` : ""}`,
    })),
    tasks: (tasks.rows as { id: string; title: string }[]).map((t) => ({ id: t.id, label: t.title })),
    edits: edits.rows as { at: string; summary: string }[],
  };
}

const fmtIso = (d: unknown) => {
  const x = d as Date;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export const planSize = (p: UndoPlan) => p.orders.length + p.deliveries.length + p.payments.length + p.documents.length + p.tasks.length;

/** Выполнить отмену: мягкое удаление + пересчёт статусов заказов + записи в журнале */
export async function applyUndo(tx: Tx, p: UndoPlan, actorId: string) {
  const now = new Date();
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const why = `отмена действий: ${p.user.name}, ${fmtDate(p.day)}`;
  const upd = async (table: "purchase_orders" | "deliveries" | "payments" | "documents" | "tasks", list: string[]) => {
    if (list.length) await tx.execute(sql`UPDATE ${sql.raw(table)} SET deleted_at = ${now} WHERE id = ANY(${sql.raw(`ARRAY[${list.map((x) => `'${x.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]`)})`);
  };
  await upd("deliveries", ids(p.deliveries));
  await upd("payments", ids(p.payments));
  await upd("documents", ids(p.documents));
  await upd("tasks", ids(p.tasks));
  await upd("purchase_orders", ids(p.orders));
  const deletedOrders = new Set(ids(p.orders));
  for (const d of p.deliveries) {
    await logActivity(tx, { userId: actorId, action: "delete", entityType: "delivery", entityId: d.id, summary: `Удалена поставка (${why}): ${d.label}` });
    if (!deletedOrders.has(d.orderId)) await logActivity(tx, { userId: actorId, action: "delete", entityType: "order", entityId: d.orderId, summary: `Удалена поставка (${why}): ${d.label}` });
  }
  for (const x of p.payments) if (x.orderId && !deletedOrders.has(x.orderId)) await logActivity(tx, { userId: actorId, action: "delete", entityType: "order", entityId: x.orderId, summary: `Удалена оплата (${why}): ${x.label}` });
  for (const x of p.documents) await logActivity(tx, { userId: actorId, action: "delete", entityType: x.entityType, entityId: x.entityId, summary: `Удалён документ (${why}): ${x.label}` });
  for (const o of p.orders) await logActivity(tx, { userId: actorId, action: "delete", entityType: "order", entityId: o.id, summary: `Заказ ${o.label} перемещён в удалённые (${why})` });
  // статусы заказов, где убрали поставки
  for (const orderId of new Set(p.deliveries.map((d) => d.orderId).filter((id) => !deletedOrders.has(id)))) await recalcOrderStatus(tx, orderId);
  await logActivity(tx, {
    userId: actorId,
    action: "delete",
    entityType: "user",
    entityId: p.user.id,
    summary: `Отменены действия сотрудника ${p.user.name} за ${fmtDate(p.day)}: заказов ${p.orders.length}, поставок ${p.deliveries.length}, оплат ${p.payments.length}, документов ${p.documents.length}, задач ${p.tasks.length}`,
  });
}

