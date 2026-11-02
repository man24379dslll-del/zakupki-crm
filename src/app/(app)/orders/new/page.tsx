import { requirePerm } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, today } from "@/lib/format";
import { ActionForm, OrderItemsEditor, SubmitButton } from "@/components/client";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { qp, type SP } from "@/components/list";
import { createOrderAction } from "../actions";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const metadata = { title: "Новый заказ" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requirePerm(PERMS.ordersEdit);
  const o = await selectOptions();
  const [lead] = await db.select().from(schema.settings).where(eq(schema.settings.key, "defaultLeadDays"));
  const d = today();
  return (
    <>
      <PageHeader title="Новый заказ" back={{ href: "/orders", label: "Заказы" }} subtitle="Номер заказа присвоится автоматически" />
      <ActionForm action={createOrderAction} className="space-y-4">
        <Card title="Основное">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Поставщик" required className="sm:col-span-2">
              <Select name="supplierId" required placeholder="Выберите поставщика" defaultValue={qp(sp, "supplier")} options={opt(o.suppliers)} />
            </Field>
            <Field label="Дата заказа">
              <Input type="date" name="orderDate" defaultValue={d} />
            </Field>
            <Field label="Статус">
              <Select name="status" defaultValue="SENT" options={[{ value: "DRAFT", label: "Черновик" }, { value: "SENT", label: "Отправлен поставщику" }, { value: "CONFIRMED", label: "Подтверждён поставщиком" }, { value: "AWAITING", label: "Ожидает поставки" }]} />
            </Field>
            <Field label="Наше юрлицо">
              <Select name="legalEntityId" placeholder="—" options={opt(o.legal)} />
            </Field>
            <Field label="Направление">
              <Select name="directionId" placeholder="—" options={opt(o.directions)} />
            </Field>
            <Field label="№ счёта">
              <Input name="invoiceNumber" />
            </Field>
            <Field label="Дата счёта">
              <Input type="date" name="invoiceDate" />
            </Field>
            <Field label="Планируемая дата поставки" hint="По ней считаются просрочки">
              <Input type="date" name="plannedDeliveryDate" defaultValue={addDays(d, Number(lead?.value ?? 30))} />
            </Field>
            {can(u, PERMS.ordersViewAll) && (
              <Field label="Закупщик">
                <Select name="buyerId" defaultValue={u.id} options={opt(o.buyers)} />
              </Field>
            )}
          </div>
        </Card>
        <Card title="Товары">
          <OrderItemsEditor products={o.products} directions={o.directions} />
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
