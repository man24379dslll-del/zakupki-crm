import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { createProductAction } from "../actions";

export const metadata = { title: "Новый товар" };

export default async function NewProduct() {
  await requirePerm(PERMS.productsEdit);
  return (
    <>
      <PageHeader title="Новый товар" back={{ href: "/products", label: "Товары" }} subtitle="Если похожий товар уже есть, система предложит его вместо создания дубля" />
      <Card>
        <ActionForm action={createProductAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Название" required><Input name="name" required /></Field>
          <Field label="Артикул"><Input name="sku" /></Field>
          <Field label="Категория"><Input name="category" /></Field>
          <Field label="Единица измерения"><Input name="unit" defaultValue="шт" /></Field>
          <Field label="Описание" className="sm:col-span-2"><Textarea name="description" /></Field>
          <div><SubmitButton>Создать</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
