import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, today } from "@/lib/format";

export function PaymentFormFields({ legal, defaultType = "PARTIAL" }: { legal: { value: string; label: string }[]; defaultType?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Дата платежа" required>
        <Input type="date" name="date" defaultValue={today()} required />
      </Field>
      <Field label="Сумма, ₽" required>
        <Input name="amount" inputMode="decimal" required />
      </Field>
      <Field label="Тип">
        <Select name="type" defaultValue={defaultType} options={Object.entries(PAYMENT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
      </Field>
      <Field label="Способ">
        <Select name="method" options={Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
      </Field>
      <Field label="№ платёжного поручения">
        <Input name="docNumber" />
      </Field>
      <Field label="Плательщик (наше юрлицо)">
        <Select searchable name="legalEntityId" placeholder="—" options={legal} />
      </Field>
      <Field label="Комментарий" className="col-span-2">
        <Textarea name="comment" rows={1} />
      </Field>
      <div className="col-span-2 sm:col-span-4">
        <SubmitButton>Сохранить платёж</SubmitButton>
      </div>
    </div>
  );
}
