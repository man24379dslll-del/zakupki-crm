import { Field, Input, Select, Textarea, cn } from "@/components/ui";

type C = { number?: string | null; date?: string | null; validUntil?: string | null; note?: string | null };

/** Поля договора с поставщиком (в форме нового поставщика и в блоке «Договоры») */
export function ContractFields({ c = {}, compact }: { c?: C; compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", !compact && "lg:grid-cols-4")}>
      <Field label="№ договора">
        <Input name="contractNumber" defaultValue={c.number ?? ""} placeholder="например, 15/2025" />
      </Field>
      <Field label="Дата договора">
        <Input name="contractDate" type="date" defaultValue={c.date ?? ""} />
      </Field>
      <Field label="Действует до" hint="Пусто — бессрочный. За 30 дней до окончания придёт напоминание">
        <Input name="contractUntil" type="date" defaultValue={c.validUntil ?? ""} />
      </Field>
      <Field label={c.number || c.date ? "Добавить файлы" : "Файлы: скан, PDF, допсоглашения"}>
        <input type="file" name="contractFile" multiple className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
      </Field>
      <Field label="Примечание" className={cn("sm:col-span-2", !compact && "lg:col-span-4")}>
        <Input name="contractNote" defaultValue={c.note ?? ""} placeholder="условия оплаты, отсрочка, особенности" />
      </Field>
    </div>
  );
}
import { SUPPLIER_STATUS_LABEL } from "@/lib/format";

type S = Partial<Record<"name" | "legalName" | "inn" | "contactPerson" | "phone" | "email" | "address" | "bankDetails" | "activity" | "comment" | "status" | "startedAt", string | null>>;

export function SupplierFields({ s = {} }: { s?: S }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Название компании" required>
        <Input name="name" defaultValue={s.name ?? ""} required />
      </Field>
      <Field label="Юридическое лицо (полное наименование)">
        <Input name="legalName" defaultValue={s.legalName ?? ""} />
      </Field>
      <Field label="ИНН">
        <Input name="inn" defaultValue={s.inn ?? ""} inputMode="numeric" />
      </Field>
      <Field label="Контактное лицо">
        <Input name="contactPerson" defaultValue={s.contactPerson ?? ""} />
      </Field>
      <Field label="Телефон">
        <Input name="phone" defaultValue={s.phone ?? ""} type="tel" />
      </Field>
      <Field label="Email">
        <Input name="email" defaultValue={s.email ?? ""} type="email" />
      </Field>
      <Field label="Адрес" className="sm:col-span-2">
        <Input name="address" defaultValue={s.address ?? ""} />
      </Field>
      <Field label="Направление деятельности">
        <Input name="activity" defaultValue={s.activity ?? ""} />
      </Field>
      <Field label="Статус сотрудничества">
        <Select name="status" defaultValue={s.status ?? "ACTIVE"} options={Object.entries(SUPPLIER_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
      </Field>
      <Field label="Начало сотрудничества">
        <Input name="startedAt" type="date" defaultValue={s.startedAt ?? ""} />
      </Field>
      <Field label="Банковские реквизиты" className="sm:col-span-2 lg:col-span-3">
        <Textarea name="bankDetails" rows={2} defaultValue={s.bankDetails ?? ""} />
      </Field>
      <Field label="Комментарий" className="sm:col-span-2 lg:col-span-3">
        <Textarea name="comment" rows={2} defaultValue={s.comment ?? ""} />
      </Field>
    </div>
  );
}
