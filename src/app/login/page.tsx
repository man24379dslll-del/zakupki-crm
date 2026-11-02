import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loginAction } from "@/app/actions/common";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">З</div>
          <h1 className="text-xl font-semibold">CRM закупок</h1>
          <p className="mt-1 text-sm text-slate-500">Войдите, чтобы продолжить</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ActionForm action={loginAction} className="space-y-4">
            <Field label="Логин">
              <Input name="login" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Пароль">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton className="w-full">Войти</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
