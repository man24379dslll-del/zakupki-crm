import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { listOrders } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, orderNo, PRIORITY_LABEL, today } from "@/lib/format";
import { ActionForm, SubmitButton, TaskKindFields } from "@/components/client";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { qp, type SP } from "@/components/list";
import { createTaskAction } from "../actions";

export const metadata = { title: "Новая задача" };

export default async function NewTask({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const o = await selectOptions();
  const orders = await listOrders(u, { where: [sql`o.status IN ('DRAFT','SENT','CONFIRMED','AWAITING','PARTIAL')`], limit: 300 });
  return (
    <>
      <PageHeader help={can(u, PERMS.tasksAssign) ? "tasks-assign" : "tasks"} title="Новая задача" back={{ href: "/tasks", label: "Задачи" }} />
      <Card>
        <ActionForm action={createTaskAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TaskKindFields products={o.products} canPurchase={can(u, PERMS.tasksAssign)} defaultKind={qp(sp, "kind") === "purchase" ? "purchase" : "general"} />
          <Field label="Название" className="sm:col-span-2 lg:col-span-4" hint="для закупки можно не заполнять"><Input name="title" /></Field>
          <Field label="Описание" className="sm:col-span-2 lg:col-span-4"><Textarea name="description" /></Field>
          {can(u, PERMS.tasksAssign) ? (
            <Field label="Исполнитель"><Select searchable name="assigneeId" defaultValue={qp(sp, "assignee") || u.id} options={opt(o.buyers)} /></Field>
          ) : <input type="hidden" name="assigneeId" value={u.id} />}
          <Field label="Срок"><Input type="date" name="dueDate" defaultValue={addDays(today(), 1)} /></Field>
          <Field label="Время"><Input type="time" name="dueTime" defaultValue="18:00" /></Field>
          <Field label="Приоритет"><Select name="priority" defaultValue="NORMAL" options={Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label="Поставщик (для закупки — желаемый, необязательно)" className="sm:col-span-2"><Select searchable name="supplierId" defaultValue={qp(sp, "supplier")} placeholder="—" options={opt(o.suppliers)} /></Field>
          <Field label="Связанный заказ" className="sm:col-span-2"><Select searchable name="orderId" defaultValue={qp(sp, "order")} placeholder="—" options={orders.map((r) => ({ value: r.id, label: `${orderNo(r.number)} · ${r.supplier_name}` }))} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><SubmitButton>Создать задачу</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
