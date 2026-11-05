import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDateTime, orderNo, PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/format";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton, TaskStepButtons } from "@/components/client";
import { TASK_ACTIVE, taskSteps, type TaskStatus } from "@/lib/task-flow";
import { DocumentsBlock, HistoryBlock } from "@/components/blocks";
import { addTaskCommentAction, setTaskStatusAction, updateTaskAction } from "../actions";

export const metadata = { title: "Задача" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const res = await db.execute(sql`SELECT t.*, a.name AS assignee, c.name AS creator, (c.is_active AND c.deleted_at IS NULL) AS creator_active, s.name AS supplier, o.number AS order_number
    FROM tasks t JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.creator_id LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN purchase_orders o ON o.id = t.order_id
    WHERE t.id = ${id} AND t.deleted_at IS NULL`);
  const t = res.rows[0] as (Record<string, string | null> & { creator_active: boolean }) | undefined;
  if (!t) notFound();
  if (t.assignee_id !== u.id && t.creator_id !== u.id && !can(u, PERMS.tasksViewAll)) return <Alert tone="red">Нет доступа к этой задаче</Alert>;
  const comments = await db.select({ c: schema.taskComments, who: schema.users.name }).from(schema.taskComments).innerJoin(schema.users, eq(schema.users.id, schema.taskComments.authorId)).where(eq(schema.taskComments.taskId, id)).orderBy(asc(schema.taskComments.createdAt));
  const status = t.status as TaskStatus;
  const overdue = t.due_date && TASK_ACTIVE.includes(status) && new Date(t.due_date) < new Date();
  const steps = u.role === "VIEWER" ? [] : taskSteps({ status, assigneeId: t.assignee_id!, creatorId: t.creator_id!, creatorActive: t.creator_active }, { id: u.id, canAssign: can(u, PERMS.tasksAssign) });
  const isAssignee = t.assignee_id === u.id;
  const self = t.assignee_id === t.creator_id;
  // подсказка, чей сейчас ход
  const hint =
    status === "NEW" ? (isAssignee ? "Задача ждёт вас: нажмите «Взять в работу», чтобы постановщик видел, что вы начали." : `Исполнитель ${t.assignee} ещё не взял задачу в работу.`)
    : status === "REVIEW" ? (isAssignee ? `Отправлено на согласование. Ждём решения: ${t.creator}.` : steps.includes("approve") ? "Исполнитель сдал задачу. Проверьте и согласуйте или верните на доработку с причиной." : `Ждёт согласования: ${t.creator}.`)
    : (status === "IN_PROGRESS" || status === "WAITING") && isAssignee && !self ? "Когда закончите — «Отправить на согласование». Задачу закроет постановщик." : null;
  const timeline: [string, string | null][] = [
    ["Поставлена", t.created_at],
    ["Взята в работу", t.started_at],
    ...(self ? [] : ([["Отправлена на согласование", t.submitted_at]] as [string, string | null][])),
    [self ? "Выполнена" : "Согласована", status === "DONE" ? t.completed_at : null],
  ];
  const canEdit = t.creator_id === u.id || can(u, PERMS.tasksAssign);
  const opts = canEdit ? await selectOptions() : null;
  const due = t.due_date ? new Date(t.due_date) : null;
  const dueLocal = due ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(due).split(" ") : ["", ""];
  return (
    <>
      <PageHeader
        back={{ href: "/tasks", label: "Задачи" }}
        title={<span className="flex flex-wrap items-center gap-2">{t.title} <Badge tone={TASK_STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>{overdue && <Badge tone="red">просрочена</Badge>}</span>}
        subtitle={`Исполнитель: ${t.assignee} · Поставил: ${t.creator} · ${fmtDateTime(t.created_at)}`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Описание">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{t.description || "—"}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
              <span>Срок: <b className={overdue ? "text-rose-600" : ""}>{t.due_date ? fmtDateTime(t.due_date) : "не задан"}</b></span>
              <Badge tone={PRIORITY_TONE[t.priority!]}>{PRIORITY_LABEL[t.priority!]}</Badge>
              {t.supplier_id && <Link className="text-brand-700 hover:underline" href={`/suppliers/${t.supplier_id}`}>{t.supplier}</Link>}
              {t.order_id && <Link className="text-brand-700 hover:underline" href={`/orders/${t.order_id}`}>Заказ {orderNo(Number(t.order_number))}</Link>}
            </div>
            {(hint || steps.length > 0) && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {hint && <p className="text-sm text-slate-600">{hint}</p>}
                <TaskStepButtons action={setTaskStatusAction} taskId={id} steps={steps} />
              </div>
            )}
          </Card>
          <Card title={`Обсуждение (${comments.length})`}>
            <ul className="mb-4 space-y-3">
              {comments.map(({ c, who }) => (
                <li key={c.id} className={c.authorId === u.id ? "ml-8 rounded-lg bg-brand-50 p-2" : "mr-8 rounded-lg bg-slate-50 p-2"}>
                  <div className="text-xs text-slate-500"><b className="text-slate-700">{who}</b> · {fmtDateTime(c.createdAt)}</div>
                  <div className="whitespace-pre-wrap text-sm">{c.text}</div>
                </li>
              ))}
            </ul>
            <ActionForm action={addTaskCommentAction} resetOnOk>
              <input type="hidden" name="id" value={id} />
              <Textarea name="text" rows={2} placeholder="Написать…" required />
              <div className="mt-2"><SubmitButton size="sm">Отправить</SubmitButton></div>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Ход задачи">
            <ol className="space-y-1.5 text-sm">
              {timeline.map(([l, at]) => (
                <li key={l} className="flex items-center gap-2">
                  <span className={at ? "text-emerald-600" : "text-slate-300"}>{at ? "●" : "○"}</span>
                  <span className={at ? "text-slate-800" : "text-slate-400"}>{l}</span>
                  <span className="ml-auto text-xs text-slate-500">{at ? fmtDateTime(at) : ""}</span>
                </li>
              ))}
              {status === "CANCELLED" && <li className="text-sm text-slate-500">Задача отменена</li>}
            </ol>
          </Card>
          {canEdit && opts && (
            <Card title="Изменить задачу">
              <ActionForm action={updateTaskAction} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Название"><Input name="title" defaultValue={t.title!} /></Field>
                <Field label="Описание"><Textarea name="description" defaultValue={t.description ?? ""} /></Field>
                <Field label="Исполнитель"><Select searchable name="assigneeId" defaultValue={t.assignee_id!} options={opt(opts.buyers)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Срок"><Input type="date" name="dueDate" defaultValue={dueLocal[0]} /></Field>
                  <Field label="Время"><Input type="time" name="dueTime" defaultValue={dueLocal[1]} /></Field>
                </div>
                <Field label="Приоритет"><Select name="priority" defaultValue={t.priority!} options={Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
                <SubmitButton size="sm">Сохранить</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <DocumentsBlock entityType="task" entityId={id} canEdit={u.role !== "VIEWER"} title="Вложения" />
          <HistoryBlock entityType="task" entityId={id} />
        </div>
      </div>
    </>
  );
}
