import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { createSupplierAction } from "../actions";
import { SupplierFields } from "../form";

export const metadata = { title: "Новый поставщик" };

export default async function NewSupplier() {
  await requirePerm(PERMS.suppliersEdit);
  return (
    <>
      <PageHeader title="Новый поставщик" back={{ href: "/suppliers", label: "Поставщики" }} />
      <Card>
        <ActionForm action={createSupplierAction}>
          <SupplierFields />
          <div className="mt-4">
            <SubmitButton>Создать</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
