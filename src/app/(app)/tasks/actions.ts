"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { logActivity, notify } from "@/lib/audit";
import { fnum, fstr, safe, UserError } from "@/lib/forms";
import { fmtQty, orderNo, TASK_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/format";
import { assertOrderAccess } from "@/lib/services/orders";
import { linkOrderToTask, purchaseTask } from "@/lib/services/purchase-tasks";
import { stepNotice, stepTarget, TASK_OPEN, TASK_STEPS, taskSteps, type TaskStep } from "@/lib/task-flow";
import type { ActionResult } from "@/components/client";

type TP = (typeof schema.taskPriority.enumValues)[number];

async function loadTask(id: string) {
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!t || t.deletedAt) throw new UserError("Задача не найдена");
  return t;
}

function parseDue(fd: FormData) {
  const d = fstr(fd.get("dueDate"));
  if (!d) return null;
  const t = fstr(fd.get("dueTime")) ?? "18:00";
  const dt = new Date(`${d}T${t}:00+03:00`);
  if (isNaN(dt.getTime())) throw new UserError("Неверный срок");
  return dt;
}

export async function createTaskAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const u = await requireUser();
    if (u.role === "VIEWER") throw new UserError("Наблюдатель не может создавать задачи");
    // «Закупка» — только руководитель с правом ставить задачи; товары берутся из справочника
    const purchase = fstr(fd.get("kind")) === "purchase";
    if (purchase && !can(u, PERMS.tasksAssign)) throw new UserError("Ставить задачи на закупку может руководитель с правом «Ставить задачи сотрудникам»");
    const items: { productId: string; qty: number; targetPrice: number | null }[] = [];
    if (purchase) {
      const prods = fd.getAll("ti_product").map(String);
      const qtys = fd.getAll("ti_qty");
      const prices = fd.getAll("ti_price");
      prods.forEach((productId, i) => {
        const qty = fnum(qtys[i]);
        if (!productId && qty === null) return;
        if (!productId) throw new UserError("Выберите товар из справочника в каждой строке");
        if (qty === null || Number.isNaN(qty) || qty <= 0) throw new UserError("Укажите количество для каждого товара");
        const pr = fnum(prices[i]);
        if (pr !== null && (Number.isNaN(pr) || pr < 0)) throw new UserError("Неверная цена-ориентир");
        items.push({ productId, qty, targetPrice: pr });
      });
      if (!items.length) throw new UserError("Добавьте хотя бы один товар, который нужно закупить");
    }
    let title = fstr(fd.get("title"));
    if (!title && purchase) {
      const names = await db.select({ id: schema.products.id, name: schema.products.name, unit: schema.products.unit }).from(schema.products);
      const nm = (pid: string) => names.find((x) => x.id === pid);
      title = `Закупить: ${items.map((it) => `${nm(it.productId)?.name ?? "товар"} ${fmtQty(it.qty)} ${nm(it.productId)?.unit ?? "шт"}.`).join(", ")}`.slice(0, 200);
    }
    if (!title) throw new UserError("Укажите название");
    let assigneeId = fstr(fd.get("assigneeId")) ?? u.id;
    if (assigneeId !== u.id && !can(u, PERMS.tasksAssign)) assigneeId = u.id; // закупщик ставит задачи только себе
    const [t] = await db
      .insert(schema.tasks)
      .values({
        title,
        kind: purchase ? "purchase" : "general",
        description: fstr(fd.get("description")),
        assigneeId,
        creatorId: u.id,
        dueDate: parseDue(fd),
        priority: (fstr(fd.get("priority")) ?? "NORMAL") as TP,
        supplierId: fstr(fd.get("supplierId")),
        orderId: fstr(fd.get("orderId")),
      })
      .returning();
    id = t.id;
    if (items.length) await db.insert(schema.taskItems).values(items.map((it, i) => ({ taskId: t.id, productId: it.productId, qty: String(it.qty), targetPrice: it.targetPrice === null ? null : String(it.targetPrice), sortOrder: i })));
    await logActivity(db, { userId: u.id, action: "create", entityType: "task", entityId: t.id, summary: `Создана задача${purchase ? " на закупку" : ""} «${title}»`, ip: await clientIp() });
    if (assigneeId !== u.id) await notify(db, { userId: assigneeId, type: "task_new", title: `Новая задача: ${title}`, body: purchase ? `От ${u.name}. Оформите заказ и привяжите его к задаче` : `От ${u.name}. Откройте задачу и нажмите «Взять в работу»`, link: `/tasks/${t.id}` });
  });
  if (r && "error" in r) return r;
  redirect(`/tasks/${id}`);
}

/** Шаг по задаче (кнопки «Взять в работу», «Отправить на согласование», «Согласовать» …). Кто какой шаг может — taskSteps() */
export async function setTaskStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    if (u.role === "VIEWER") throw new UserError("Нет прав");
    const t = await loadTask(String(fd.get("id")));
    const step = String(fd.get("step")) as TaskStep;
    if (!(step in TASK_STEPS)) throw new UserError("Неизвестное действие");
    const [creator] = await db.select({ isActive: schema.users.isActive, deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, t.creatorId));
    const allowed = taskSteps({ status: t.status, assigneeId: t.assigneeId, creatorId: t.creatorId, creatorActive: !!creator?.isActive && !creator.deletedAt }, { id: u.id, canAssign: can(u, PERMS.tasksAssign) });
    if (!allowed.includes(step)) throw new UserError(`Сейчас это действие недоступно (задача «${TASK_STATUS_LABEL[t.status]}»). Обновите страницу.`);
    const comment = fstr(fd.get("comment"));
    if (TASK_STEPS[step].comment === "required" && !comment) throw new UserError(`Напишите, ${step === "return" ? "что нужно доделать" : "почему открываете заново"}`);
    if (t.kind === "purchase" && (step === "submit" || step === "done")) {
      const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM task_orders WHERE task_id = ${t.id}`)).rows as { n: number }[];
      if (!n) throw new UserError("Сначала привяжите заказ, которым выполнена закупка: «Создать заказ по задаче» или «Привязать заказ»");
    }
    const status = stepTarget(step, t.status);
    const now = new Date();
    const label = TASK_STEPS[step].label;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.tasks)
        .set({
          status,
          completedAt: status === "DONE" ? now : null,
          ...(step === "start" && !t.startedAt ? { startedAt: now } : {}),
          ...(step === "submit" ? { submittedAt: now } : {}),
        })
        .where(eq(schema.tasks.id, t.id));
      if (comment) await tx.insert(schema.taskComments).values({ taskId: t.id, authorId: u.id, text: `${label}: ${comment}` });
      await logActivity(tx, { userId: u.id, action: "status", entityType: "task", entityId: t.id, summary: `${label}: ${TASK_STATUS_LABEL[t.status]} → ${TASK_STATUS_LABEL[status]}`, changes: { Статус: [TASK_STATUS_LABEL[t.status], TASK_STATUS_LABEL[status]], ...(comment ? { Комментарий: [null, comment] } : {}) } });
      for (const other of new Set([t.assigneeId, t.creatorId])) if (other !== u.id) await notify(tx, { userId: other, type: "task_status", title: stepNotice(step, t.title), body: comment ? `${u.name}: ${comment.slice(0, 160)}` : u.name, link: `/tasks/${t.id}` });
    });
    revalidatePath(`/tasks/${t.id}`);
    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: `Готово: ${TASK_STATUS_LABEL[status]}` };
  });
}

export async function updateTaskAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const t = await loadTask(String(fd.get("id")));
    if (t.creatorId !== u.id && !can(u, PERMS.tasksAssign)) throw new UserError("Менять задачу может постановщик или руководитель");
    const title = fstr(fd.get("title")) ?? t.title;
    const assigneeId = fstr(fd.get("assigneeId")) ?? t.assigneeId;
    const dueDate = parseDue(fd);
    const priority = (fstr(fd.get("priority")) ?? t.priority) as TP;
    const changes: Record<string, [unknown, unknown]> = {};
    if (title !== t.title) changes["Название"] = [t.title, title];
    if (assigneeId !== t.assigneeId) changes["Исполнитель"] = [t.assigneeId, assigneeId];
    if ((dueDate?.toISOString() ?? null) !== (t.dueDate?.toISOString() ?? null)) changes["Срок"] = [t.dueDate?.toISOString() ?? null, dueDate?.toISOString() ?? null];
    if (priority !== t.priority) changes["Приоритет"] = [PRIORITY_LABEL[t.priority], PRIORITY_LABEL[priority]];
    // передали другому исполнителю — он должен сам взять задачу в работу
    const reassigned = assigneeId !== t.assigneeId && TASK_OPEN.includes(t.status);
    if (reassigned && t.status !== "NEW") changes["Статус"] = [TASK_STATUS_LABEL[t.status], TASK_STATUS_LABEL.NEW];
    await db
      .update(schema.tasks)
      .set({ title, description: fstr(fd.get("description")), assigneeId, dueDate, priority, remindedAt: changes["Срок"] ? null : t.remindedAt, ...(reassigned ? { status: "NEW" as const, startedAt: null, submittedAt: null } : {}) })
      .where(eq(schema.tasks.id, t.id));
    await logActivity(db, { userId: u.id, action: "update", entityType: "task", entityId: t.id, summary: "Задача изменена", changes });
    if (assigneeId !== t.assigneeId) await notify(db, { userId: assigneeId, type: "task_new", title: `Вам передана задача: ${title}`, body: "Откройте задачу и нажмите «Взять в работу»", link: `/tasks/${t.id}` });
    revalidatePath(`/tasks/${t.id}`);
    return { ok: "Сохранено" };
  });
}

export async function addTaskCommentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const t = await loadTask(String(fd.get("id")));
    if (t.assigneeId !== u.id && t.creatorId !== u.id && !can(u, PERMS.tasksViewAll)) throw new UserError("Нет доступа");
    const text = fstr(fd.get("text"));
    if (!text) throw new UserError("Пустой комментарий");
    await db.insert(schema.taskComments).values({ taskId: t.id, authorId: u.id, text });
    for (const other of new Set([t.assigneeId, t.creatorId])) if (other !== u.id) await notify(db, { userId: other, type: "task_comment", title: `Комментарий к «${t.title}»`, body: `${u.name}: ${text.slice(0, 120)}`, link: `/tasks/${t.id}` });
    revalidatePath(`/tasks/${t.id}`);
    return { ok: "Отправлено" };
  });
}

/** Привязать существующий заказ к задаче «Закупка» (исполнитель, постановщик или руководитель) */
export async function linkTaskOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const taskId = String(fd.get("id"));
    const orderId = fstr(fd.get("orderId"));
    if (!orderId) throw new UserError("Выберите заказ");
    const t = await purchaseTask(db, taskId);
    if (t.assignee_id !== u.id && t.creator_id !== u.id && !can(u, PERMS.tasksAssign)) throw new UserError("Привязать заказ может исполнитель задачи");
    await assertOrderAccess(u, orderId);
    const r = await db.transaction((tx) => linkOrderToTask(tx, taskId, orderId, u));
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath(`/orders/${orderId}`);
    return { ok: `Заказ ${orderNo(r.orderNumber)} привязан` };
  });
}

/** Отвязать заказ, пока задача не сдана на согласование */
export async function unlinkTaskOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const taskId = String(fd.get("id"));
    const orderId = String(fd.get("orderId"));
    const t = await purchaseTask(db, taskId);
    if (t.assignee_id !== u.id && t.creator_id !== u.id && !can(u, PERMS.tasksAssign)) throw new UserError("Нет доступа к задаче");
    if (!["NEW", "IN_PROGRESS", "WAITING"].includes(t.status)) throw new UserError("Задача уже сдана или закрыта — сначала верните её в работу");
    const del = await db.delete(schema.taskOrders).where(and(eq(schema.taskOrders.taskId, taskId), eq(schema.taskOrders.orderId, orderId))).returning();
    if (!del.length) throw new UserError("Заказ уже отвязан");
    const [o] = await db.select({ number: schema.purchaseOrders.number }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId));
    await logActivity(db, { userId: u.id, action: "update", entityType: "task", entityId: taskId, summary: `Отвязан заказ ${o ? orderNo(o.number) : ""}` });
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath(`/orders/${orderId}`);
  });
}
