import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PERM_LABELS, type Perm } from "@/lib/permissions";
import { Card, btnClass } from "@/components/ui";
import { qp, type SP } from "@/components/list";

export const metadata = { title: "Нет доступа" };

/** Сюда ведёт requirePagePerm: раздел закрыт правами сотрудника */
export default async function NoAccess({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const perm = qp(await searchParams, "perm") as Perm;
  const label = PERM_LABELS[perm];
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">Нет доступа к этому разделу</h1>
        <p className="mt-2 text-sm text-slate-600">
          {label ? <>Для него нужно право «{label}».</> : "У вас нет права открывать этот раздел."} Если оно нужно для работы, попросите руководителя выдать его в разделе «Пользователи».
        </p>
        <Link href="/" className={btnClass("primary", "md") + " mt-4"}>
          На главную
        </Link>
      </Card>
    </div>
  );
}
