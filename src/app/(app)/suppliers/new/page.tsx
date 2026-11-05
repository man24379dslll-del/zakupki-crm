import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { createSupplierAction } from "../actions";
import { ContractFields, SupplierFields } from "../form";

export const metadata = { title: "Новый поставщик" };

export default async function NewSupplier() {
  await requirePerm(PERMS.suppliersEdit);
  return (
    <>
      <PageHeader title="Новый поставщик" back={{ href: "/suppliers", label: "Поставщики" }} />
      <Card>
        <ActionForm action={createSupplierAction}>
          <SupplierFields />
          <h2 className="mb-2 mt-6 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-800">Договор с поставщиком <span className="font-normal text-slate-500">— можно заполнить сейчас или позже в карточке</span></h2>
          <ContractFields />
          <div className="mt-4">
            <SubmitButton>Создать</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
