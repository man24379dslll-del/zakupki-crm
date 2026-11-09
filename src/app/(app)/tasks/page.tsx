import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { opt, selectOptions } from "@/lib/services/refs";
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { FilterBar, FSelect, qp, SearchInput, type SP } from "@/components/list";
import { TaskList, TASK_FROM, TASK_SELECT, type TaskRow } from "./task-list";
import { sqlList, TASK_ACTIVE, TASK_OPEN } from "@/lib/task-flow";

export const metadata = { title: "Задачи" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const all = can(u, PERMS.tasksViewAll);
  const w = [sql`t.deleted_at IS NULL`];
  const who = qp(sp, "who") || (all ? "" : "me");
  if (!all) w.push(sql`(t.assignee_id = ${u.id} OR t.creator_id = ${u.id})`);
  if (who === "me") w.push(sql`t.assignee_id = ${u.id}`);
  else if (who === "byme") w.push(sql`t.creator_id = ${u.id}`);
  else if (who === "approve") w.push(sql`t.creator_id = ${u.id} AND t.assignee_id <> ${u.id} AND t.status = 'REVIEW'`);
  else if (who && all) w.push(sql`t.assignee_id = ${who}`);
  const st = qp(sp, "status") || (who === "approve" ? "all" : "open");
  if (st === "open") w.push(sql.raw(`t.status IN (${sqlList(TASK_OPEN)})`));
  else if (st === "overdue") w.push(sql.raw(`t.status IN (${sqlList(TASK_ACTIVE)}) AND t.due_date < now()`));
  else if (st !== "all") w.push(sql`t.status = ${st}`);
  const due = qp(sp, "due");
  if (due === "today") w.push(sql`t.due_date::date = (now() AT TIME ZONE 'Europe/Moscow')::date`);
  if (due === "week") w.push(sql`t.due_date < now() + interval '7 days'`);
  const pr = qp(sp, "priority");
  if (pr) w.push(sql`t.priority = ${pr}`);
  const q = qp(sp, "q");
  if (q) w.push(sql`(t.title ILIKE ${"%" + q + "%"} OR t.description ILIKE ${"%" + q + "%"})`);
  const res = await db.execute(sql`SELECT ${sql.raw(TASK_SELECT)} FROM ${sql.raw(TASK_FROM)} WHERE ${sql.join(w, sql` AND `)}
    ORDER BY (t.status IN ('DONE','CANCELLED')), overdue DESC, t.due_date NULLS LAST, CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t.created_at DESC LIMIT 300`);
  const rows = res.rows as unknown as TaskRow[];
  const opts = all ? await selectOptions() : null;
  return (
    <>
      <PageHeader help={"tasks"} title="Задачи" actions={u.role !== "VIEWER" && <LinkButton href="/tasks/new" variant="primary">+ Задача</LinkButton>} />
      <FilterBar base="/tasks" sp={sp}>
        <SearchInput sp={sp} />
        <FSelect name="who" sp={sp} placeholder={all ? "Все сотрудники" : "Мои и поставленные мной"} options={[{ value: "me", label: "Мне" }, { value: "byme", label: "Поставленные мной" }, { value: "approve", label: "Ждут моего согласования" }, ...(opts ? opt(opts.buyers) : [])]} />
        <FSelect name="status" sp={sp} placeholder="Открытые" options={[{ value: "overdue", label: "Просроченные" }, { value: "all", label: "Все" }, ...Object.entries(TASK_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
        <FSelect name="due" sp={sp} placeholder="Любой срок" options={[{ value: "today", label: "На сегодня" }, { value: "week", label: "До 7 дней" }]} />
        <FSelect name="priority" sp={sp} placeholder="Любой приоритет" options={Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
      </FilterBar>
      <Card pad={false}>{rows.length ? <TaskList rows={rows} showWaiting={who === "byme" || who === "approve"} showAssignee={all || who === "byme" || who === "approve"} me={u.role === "VIEWER" ? null : { id: u.id, canAssign: can(u, PERMS.tasksAssign) }} /> : <Empty>Задач нет</Empty>}</Card>
    </>
  );
}
