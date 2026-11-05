/**
 * Ход задачи: кто какую кнопку видит на каждом шаге. Чистые функции — проверяются на сервере в setTaskStatusAction
 * и используются для кнопок в задаче и в списках.
 *
 * Исполнитель: Новая → «Взять в работу» → В работе ⇄ Ожидает ответа → «Отправить на согласование» → На согласовании.
 * Постановщик: «Согласовать» → Выполнена или «Вернуть на доработку» (с причиной) → В работе; «Отменить», «Открыть заново».
 * Задача самому себе — без согласования: исполнитель сразу отмечает «Выполнена».
 */
export type TaskStatus = "NEW" | "IN_PROGRESS" | "WAITING" | "REVIEW" | "DONE" | "CANCELLED";
export type TaskStep = "start" | "wait" | "resume" | "submit" | "done" | "approve" | "return" | "cancel" | "reopen";

/** открытые задачи (ещё не выполнены и не отменены) */
export const TASK_OPEN: TaskStatus[] = ["NEW", "IN_PROGRESS", "WAITING", "REVIEW"];
/** задача за исполнителем: для просрочки и счётчика «мои задачи» (на согласовании — ход постановщика) */
export const TASK_ACTIVE: TaskStatus[] = ["NEW", "IN_PROGRESS", "WAITING"];
export const sqlList = (s: TaskStatus[]) => s.map((x) => `'${x}'`).join(",");

export const TASK_STEPS: Record<TaskStep, { label: string; comment?: "required" | "optional"; tone: "primary" | "secondary" | "danger"; placeholder?: string }> = {
  start: { label: "Взять в работу", tone: "primary" },
  submit: { label: "Отправить на согласование", tone: "primary", comment: "optional", placeholder: "Что сделано (необязательно)" },
  done: { label: "Выполнена", tone: "primary" },
  approve: { label: "Согласовать", tone: "primary" },
  return: { label: "Вернуть на доработку", tone: "secondary", comment: "required", placeholder: "Что нужно доделать" },
  wait: { label: "Жду ответа", tone: "secondary" },
  resume: { label: "Продолжить работу", tone: "secondary" },
  reopen: { label: "Открыть заново", tone: "secondary", comment: "required", placeholder: "Почему открываем заново" },
  cancel: { label: "Отменить задачу", tone: "danger" },
};

/** В какой статус переводит шаг */
export function stepTarget(step: TaskStep, from: TaskStatus): TaskStatus {
  switch (step) {
    case "start":
    case "resume":
    case "return":
      return "IN_PROGRESS";
    case "wait":
      return "WAITING";
    case "submit":
      return "REVIEW";
    case "done":
    case "approve":
      return "DONE";
    case "cancel":
      return "CANCELLED";
    case "reopen":
      return from === "CANCELLED" ? "NEW" : "IN_PROGRESS";
  }
}

export interface FlowTask {
  status: TaskStatus;
  assigneeId: string;
  creatorId: string;
  /** постановщик работает (не заблокирован и не удалён) */
  creatorActive: boolean;
}
export interface FlowUser {
  id: string;
  /** право «Ставить задачи сотрудникам» (руководитель) */
  canAssign: boolean;
}

/** Кнопки, доступные сотруднику, — главная первой */
export function taskSteps(t: FlowTask, u: FlowUser): TaskStep[] {
  const self = t.assigneeId === t.creatorId;
  const isAssignee = t.assigneeId === u.id;
  const isCreator = t.creatorId === u.id;
  // согласует постановщик; если его уже нет в программе — руководитель с правом ставить задачи
  const approver = isCreator || (!t.creatorActive && u.canAssign);
  const manager = isCreator || u.canAssign;
  const s: TaskStep[] = [];
  if (isAssignee) {
    const finish: TaskStep = self ? "done" : "submit";
    if (t.status === "NEW") s.push("start", ...(self ? (["done"] as TaskStep[]) : []));
    if (t.status === "IN_PROGRESS") s.push(finish, "wait");
    if (t.status === "WAITING") s.push(finish, "resume");
  }
  if (t.status === "REVIEW" && approver) s.push("approve", "return");
  if (manager && TASK_OPEN.includes(t.status)) s.push("cancel");
  if (manager && (t.status === "DONE" || t.status === "CANCELLED")) s.push("reopen");
  return [...new Set(s)];
}

/** Текст уведомления другой стороне о шаге */
export function stepNotice(step: TaskStep, title: string): string {
  const q = `«${title}»`;
  return {
    start: `Взята в работу: ${q}`,
    wait: `Ожидает ответа: ${q}`,
    resume: `Снова в работе: ${q}`,
    submit: `Ждёт вашего согласования: ${q}`,
    done: `Выполнена: ${q}`,
    approve: `Задача согласована: ${q}`,
    return: `Вернули на доработку: ${q}`,
    cancel: `Задача отменена: ${q}`,
    reopen: `Задача открыта заново: ${q}`,
  }[step];
}
