import { requirePagePerm } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, today } from "@/lib/format";
import { ActionForm, OrderItemsEditor, OrderPayFields, SubmitButton } from "@/components/client";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { qp, type SP } from "@/components/list";
import { createOrderAction } from "../actions";
import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";

export const metadata = { title: "Новый заказ" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requirePagePerm(PERMS.ordersEdit);
  const o = await selectOptions();
  const [lead] = await db.select().from(schema.settings).where(eq(schema.settings.key, "defaultLeadDays"));
  const d = today();
  // заказ по задаче «Закупка»: товары, количество, ориентир цены и поставщик — из задачи
  const taskId = /^[0-9a-f-]{36}$/.test(qp(sp, "task")) ? qp(sp, "task") : "";
  const task = taskId
    ? ((await db.execute(sql`SELECT t.id, t.title, t.supplier_id FROM tasks t WHERE t.id = ${taskId} AND t.kind = 'purchase' AND t.deleted_at IS NULL`)).rows[0] as { id: string; title: string; supplier_id: string | null } | undefined)
    : undefined;
  const taskItems = task
    ? ((await db.execute(sql`SELECT pr.name, ti.qty, ti.target_price FROM task_items ti JOIN products pr ON pr.id = ti.product_id WHERE ti.task_id = ${task.id} ORDER BY ti.sort_order`)).rows as { name: string; qty: string; target_price: string | null }[])
    : [];
  return (
    <>
      <PageHeader title="Новый заказ" back={task ? { href: `/tasks/${task.id}`, label: "Задача" } : { href: "/orders", label: "Заказы" }} subtitle="Номер заказа присвоится автоматически" />
      <ActionForm action={createOrderAction} className="space-y-4">
        {task && (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
            <input type="hidden" name="taskId" value={task.id} />
            Заказ по задаче <b>«{task.title}»</b> — товары и количество подставлены из задачи, их можно изменить. После сохранения заказ сам привяжется к задаче. Дата заказа не может быть раньше даты задачи.
          </div>
        )}
        <Card title="Основное">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Поставщик" required className="sm:col-span-2">
              <Select searchable name="supplierId" required placeholder="Начните вводить название или ИНН" defaultValue={qp(sp, "supplier") || task?.supplier_id || ""} options={opt(o.suppliers)} createPrefix={can(u, PERMS.suppliersEdit) ? "new:" : undefined} />
            </Field>
            <Field label="Дата заказа">
              <Input type="date" name="orderDate" defaultValue={d} />
            </Field>
            <Field label="Статус">
              <Select name="status" defaultValue="SENT" options={[{ value: "DRAFT", label: "Черновик" }, { value: "SENT", label: "Отправлен поставщику" }, { value: "CONFIRMED", label: "Подтверждён поставщиком" }, { value: "AWAITING", label: "Ожидает поставки" }]} />
            </Field>
            <Field label="Наше юрлицо">
              <Select searchable name="legalEntityId" placeholder="—" options={opt(o.legal)} />
            </Field>
            <Field label="Направление">
              <Select searchable name="directionId" placeholder="—" options={opt(o.directions)} />
            </Field>
            <Field label="№ счёта">
              <Input name="invoiceNumber" />
            </Field>
            <Field label="Дата счёта">
              <Input type="date" name="invoiceDate" />
            </Field>
            <OrderPayFields className="sm:col-span-2" />
            <Field label="Плановая дата поставки" hint="Общая для всех товаров. Если у товара другой срок — укажите его в строке товара">
              <Input type="date" name="plannedDeliveryDate" defaultValue={addDays(d, Number(lead?.value ?? 30))} />
            </Field>
            {can(u, PERMS.ordersViewAll) && (
              <Field label="Закупщик">
                <Select searchable name="buyerId" defaultValue={u.id} options={opt(o.buyers)} />
              </Field>
            )}
          </div>
        </Card>
        <Card title="Товары">
          <OrderItemsEditor products={o.products} directions={o.directions} initial={taskItems.length ? taskItems.map((x) => ({ productName: x.name, qty: String(Number(x.qty)), price: x.target_price === null ? "" : String(Number(x.target_price)) })) : undefined} />
        </Card>
        <Card title="Комментарий">
          <Textarea name="comment" placeholder="Условия, договорённости…" />
          <p className="mt-2 text-xs text-slate-500">Документы (счёт, спецификацию) можно прикрепить на странице заказа после сохранения.</p>
        </Card>
        <div className="flex gap-2">
          <SubmitButton>Создать заказ</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
