import Link from "next/link";
import { fmtDateTime, PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/format";
import { sqlList, TASK_ACTIVE, taskSteps, type FlowUser, type TaskStatus } from "@/lib/task-flow";
import { Badge, cn } from "@/components/ui";
import { TaskStepButtons } from "@/components/client";
import { setTaskStatusAction } from "./actions";

export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  due_date: string | null;
  assignee_id: string;
  creator_id: string;
  creator_active: boolean;
  assignee: string;
  creator: string;
  supplier: string | null;
  order_number: number | null;
  overdue: boolean;
  due_soon: boolean;
}

/** me — кто смотрит (null — наблюдатель, без кнопок). У строки — статус и главная кнопка следующего шага */
export function TaskList({ rows, showAssignee, me }: { rows: TaskRow[]; showAssignee?: boolean; me: FlowUser | null }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((t) => {
        const steps = me ? taskSteps({ status: t.status, assigneeId: t.assignee_id, creatorId: t.creator_id, creatorActive: t.creator_active }, me) : [];
        const mine = me && t.assignee_id === me.id && t.creator_id !== me.id;
        return (
          <li key={t.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", t.overdue && "bg-rose-50/50")}>
            <div className="min-w-0 flex-1">
              <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                {t.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                {t.priority !== "NORMAL" && <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>}
                {t.due_date && <span className={cn(t.overdue && "font-semibold text-rose-600", t.due_soon && !t.overdue && "font-medium text-amber-700")}>срок {fmtDateTime(t.due_date)}{t.overdue && " — просрочена"}</span>}
                {showAssignee && <span>· исполнитель {t.assignee}</span>}
                {mine && <span>· от {t.creator}</span>}
                {t.supplier && <span>· {t.supplier}</span>}
                {t.order_number && <span>· заказ З-{String(t.order_number).padStart(5, "0")}</span>}
              </div>
            </div>
            <TaskStepButtons action={setTaskStatusAction} taskId={t.id} steps={steps} compact />
          </li>
        );
      })}
    </ul>
  );
}

export const TASK_SELECT = `
  t.id, t.title, t.status, t.priority, t.due_date, t.assignee_id, t.creator_id, (c.is_active AND c.deleted_at IS NULL) AS creator_active,
  a.name AS assignee, c.name AS creator, s.name AS supplier, o.number AS order_number,
  (t.status IN (${sqlList(TASK_ACTIVE)}) AND t.due_date < now()) AS overdue,
  (t.status IN (${sqlList(TASK_ACTIVE)}) AND t.due_date BETWEEN now() AND now() + interval '2 days') AS due_soon`;
export const TASK_FROM = `tasks t JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.creator_id LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN purchase_orders o ON o.id = t.order_id`;
