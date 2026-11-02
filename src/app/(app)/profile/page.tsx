import { requireUser } from "@/lib/auth";
import { PERM_LABELS, type Perm } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/format";
import { changePasswordAction } from "@/app/actions/common";
import { ActionForm, SubmitButton } from "@/components/client";
import { Alert, Card, Field, Input, PageHeader } from "@/components/ui";

export const metadata = { title: "Профиль" };

export default async function Profile({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const u = await requireUser();
  const { first } = await searchParams;
  return (
    <>
      <PageHeader title={u.name} subtitle={`${ROLE_LABEL[u.role]} · логин ${u.login}`} />
      {first && <div className="mb-4"><Alert>Вы вошли с временным паролем — задайте свой.</Alert></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Смена пароля">
          <ActionForm action={changePasswordAction} resetOnOk className="space-y-3">
            <Field label="Текущий пароль"><Input type="password" name="current" required autoComplete="current-password" /></Field>
            <Field label="Новый пароль" hint="Не короче 8 символов"><Input type="password" name="next" required minLength={8} autoComplete="new-password" /></Field>
            <SubmitButton>Сменить пароль</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Мои права">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {[...u.perms].map((p) => <li key={p}>{PERM_LABELS[p as Perm] ?? p}</li>)}
            {u.perms.size === 0 && <li>Просмотр своих данных и справочников</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
