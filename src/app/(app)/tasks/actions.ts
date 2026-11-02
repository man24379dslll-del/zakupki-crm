"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { logActivity, notify } from "@/lib/audit";
import { fstr, safe, UserError } from "@/lib/forms";
import { TASK_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/format";
import type { ActionResult } from "@/components/client";

type TS = (typeof schema.taskStatus.enumValues)[number];
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
    const title = fstr(fd.get("title"));
    if (!title) throw new UserError("Укажите название");
    let assigneeId = fstr(fd.get("assigneeId")) ?? u.id;
    if (assigneeId !== u.id && !can(u, PERMS.tasksAssign)) assigneeId = u.id; // закупщик ставит задачи только себе
    const [t] = await db
      .insert(schema.tasks)
      .values({
        title,
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
    await logActivity(db, { userId: u.id, action: "create", entityType: "task", entityId: t.id, summary: `Создана задача «${title}»`, ip: await clientIp() });
    if (assigneeId !== u.id) await notify(db, { userId: assigneeId, type: "task_new", title: `Новая задача: ${title}`, body: `От ${u.name}`, link: `/tasks/${t.id}` });
  });
  if (r && "error" in r) return r;
  redirect(`/tasks/${id}`);
}

export async function setTaskStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const t = await loadTask(String(fd.get("id")));
    if (t.assigneeId !== u.id && t.creatorId !== u.id && !can(u, PERMS.tasksViewAll)) throw new UserError("Нет доступа к задаче");
    if (u.role === "VIEWER") throw new UserError("Нет прав");
    const status = String(fd.get("status")) as TS;
    if (!(status in TASK_STATUS_LABEL)) throw new UserError("Неверный статус");
    if (status === t.status) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.tasks).set({ status, completedAt: status === "DONE" ? new Date() : null }).where(eq(schema.tasks.id, t.id));
      await logActivity(tx, { userId: u.id, action: "status", entityType: "task", entityId: t.id, summary: `Статус: ${TASK_STATUS_LABEL[t.status]} → ${TASK_STATUS_LABEL[status]}`, changes: { Статус: [TASK_STATUS_LABEL[t.status], TASK_STATUS_LABEL[status]] } });
      const other = u.id === t.assigneeId ? t.creatorId : t.assigneeId;
      if (other !== u.id) await notify(tx, { userId: other, type: "task_status", title: `«${t.title}»: ${TASK_STATUS_LABEL[status]}`, body: u.name, link: `/tasks/${t.id}` });
    });
    revalidatePath(`/tasks/${t.id}`);
    revalidatePath("/tasks");
    revalidatePath("/");
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
    await db.update(schema.tasks).set({ title, description: fstr(fd.get("description")), assigneeId, dueDate, priority, remindedAt: changes["Срок"] ? null : t.remindedAt }).where(eq(schema.tasks.id, t.id));
    await logActivity(db, { userId: u.id, action: "update", entityType: "task", entityId: t.id, summary: "Задача изменена", changes });
    if (assigneeId !== t.assigneeId) await notify(db, { userId: assigneeId, type: "task_new", title: `Вам передана задача: ${title}`, link: `/tasks/${t.id}` });
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
