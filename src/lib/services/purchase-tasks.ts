import "server-only";
import { sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { logActivity, notify } from "@/lib/audit";
import { orderNo } from "@/lib/format";
import { UserError } from "@/lib/forms";
import { linkError } from "@/lib/purchase";

/** Задача «Закупка» по id: даты для проверки привязки заказов */
export async function purchaseTask(tx: Tx | typeof db, taskId: string) {
  const [t] = (await tx.execute(sql`SELECT t.id, t.title, t.kind, t.status, t.assignee_id, t.creator_id, t.created_at, t.started_at,
      to_char(t.created_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day
    FROM tasks t WHERE t.id = ${taskId} AND t.deleted_at IS NULL`)).rows as { id: string; title: string; kind: string; status: string; assignee_id: string; creator_id: string; created_at: string | Date; started_at: string | null; day: string }[];
  if (!t) throw new UserError("Задача не найдена");
  if (t.kind !== "purchase") throw new UserError("Это не задача на закупку");
  return t;
}

/**
 * Привязать заказ к задаче «Закупка» (проверки: заказ оформлен после постановки задачи, не отменён).
 * Если задача ещё «Новая» — она считается взятой в работу. Постановщик получает уведомление.
 */
export async function linkOrderToTask(tx: Tx, taskId: string, orderId: string, actor: { id: string; name: string }) {
  const t = await purchaseTask(tx, taskId);
  if (!["NEW", "IN_PROGRESS", "WAITING"].includes(t.status)) throw new UserError("Задача уже сдана или закрыта — привязать заказ нельзя");
  const [o] = (await tx.execute(sql`SELECT id, number, status, deleted_at IS NOT NULL AS deleted, order_date::text AS order_date, created_at FROM purchase_orders WHERE id = ${orderId}`)).rows as { id: string; number: number; status: string; deleted: boolean; order_date: string; created_at: string | Date }[];
  if (!o) throw new UserError("Заказ не найден");
  const err = linkError({ day: t.day, createdAt: new Date(t.created_at).getTime() }, { orderDate: o.order_date, createdAt: new Date(o.created_at).getTime(), status: o.status, deleted: o.deleted });
  if (err) throw new UserError(`${orderNo(o.number)}: ${err}`);
  const ins = await tx.insert(schema.taskOrders).values({ taskId, orderId, linkedById: actor.id }).onConflictDoNothing().returning();
  if (!ins.length) throw new UserError(`${orderNo(o.number)} уже привязан к этой задаче`);
  if (t.status === "NEW") {
    await tx.execute(sql`UPDATE tasks SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now()) WHERE id = ${taskId}`);
    await logActivity(tx, { userId: actor.id, action: "status", entityType: "task", entityId: taskId, summary: "Взять в работу: Новая → В работе (привязан заказ)", changes: { Статус: ["Новая", "В работе"] } });
  }
  await logActivity(tx, { userId: actor.id, action: "update", entityType: "task", entityId: taskId, summary: `Привязан заказ ${orderNo(o.number)}` });
  await logActivity(tx, { userId: actor.id, action: "update", entityType: "order", entityId: orderId, summary: `Заказ привязан к задаче «${t.title}»` });
  if (t.creator_id !== actor.id) await notify(tx, { userId: t.creator_id, type: "task_status", title: `К задаче «${t.title}» привязан заказ ${orderNo(o.number)}`, body: actor.name, link: `/tasks/${taskId}` });
  return { task: t, orderNumber: o.number };
}
