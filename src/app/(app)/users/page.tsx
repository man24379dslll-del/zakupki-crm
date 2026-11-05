import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePagePerm } from "@/lib/auth";
import { effectivePerms, GRANTABLE, PERM_GROUPS, PERMS, PERM_LABELS, ROLE_DEFAULTS } from "@/lib/permissions";

const ALL_PERMS = Object.values(PERMS);
import { fmtDateTime, ROLE_LABEL } from "@/lib/format";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { createUserAction, resetPasswordAction, toggleBlockAction, updateUserAction } from "./actions";

export const metadata = { title: "Пользователи" };

type U = { id: string; role: string; role_perms: string[]; extra_permissions: string[]; revoked_permissions: string[] };

/** Права сотрудника: галочки — итоговые права; «по роли» — что даёт роль, его можно снять (и у руководителя) */
function PermsEditor({ user: u }: { user: U }) {
  const eff = effectivePerms(u.role_perms, u.extra_permissions, u.revoked_permissions);
  const changed = u.extra_permissions.length + u.revoked_permissions.length;
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 sm:col-span-2 lg:col-span-6" open={u.role !== "ADMIN"}>
      <summary className="cursor-pointer text-xs font-medium text-slate-700">
        Права доступа: {eff.size} из {ALL_PERMS.length}
        {changed > 0 && <span className="ml-2 text-amber-700">изменены относительно роли</span>}
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PERM_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-xs font-semibold text-slate-500">{g.title}</div>
            {g.perms.map((p) => (
              <label key={p} className="flex items-start gap-1.5 py-0.5 text-xs text-slate-700">
                <input type="checkbox" name="perm" value={p} defaultChecked={eff.has(p)} className="mt-0.5" />
                <span>
                  {PERM_LABELS[p]}
                  {u.role_perms.includes(p) && <span className="ml-1 text-slate-400">· по роли</span>}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">При смене роли права сбрасываются на права новой роли. Изменения действуют сразу, перезаходить не нужно.</p>
    </details>
  );
}

const roleOptions = Object.entries(ROLE_LABEL).map(([v, l]) => ({ value: v, label: l }));

export default async function UsersPage() {
  const me = await requirePagePerm(PERMS.usersManage);
  const res = await db.execute(sql`SELECT u.*, r.code AS role, r.permissions AS role_perms,
      (SELECT COUNT(*) FROM purchase_orders o WHERE o.buyer_id = u.id AND o.deleted_at IS NULL)::int AS orders,
      (SELECT string_agg(s.name, ', ') FROM supplier_buyers sb JOIN suppliers s ON s.id = sb.supplier_id WHERE sb.user_id = u.id) AS suppliers
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.is_active DESC, r.code, u.name`);
  const users = res.rows as { id: string; login: string; name: string; email: string | null; phone: string | null; position: string | null; role: string; role_perms: string[]; extra_permissions: string[]; revoked_permissions: string[]; is_active: boolean; last_login_at: string | null; orders: number; suppliers: string | null }[];
  return (
    <>
      <PageHeader title="Пользователи и права" subtitle="Закупщик видит только свои заказы и показатели, пока ему не выдано право «Видеть заказы всех закупщиков»" />
      <Card title="Добавить сотрудника" className="mb-4">
        <ActionForm action={createUserAction} resetOnOk className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="ФИО" required className="lg:col-span-2"><Input name="name" required /></Field>
          <Field label="Логин" required><Input name="login" required placeholder="ivanov" /></Field>
          <Field label="Роль"><Select name="role" defaultValue="BUYER" options={roleOptions} /></Field>
          <Field label="Должность"><Input name="position" /></Field>
          <Field label="Пароль" hint="пусто — сгенерировать"><Input name="password" /></Field>
          <Field label="Телефон"><Input name="phone" /></Field>
          <Field label="Email"><Input name="email" type="email" /></Field>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1 text-xs lg:col-span-3">
            {GRANTABLE.map((p) => (
              <label key={p} className="flex items-center gap-1"><input type="checkbox" name="perm" value={p} /> {PERM_LABELS[p]}</label>
            ))}
          </div>
          <div className="flex items-end"><SubmitButton>Добавить</SubmitButton></div>
        </ActionForm>
      </Card>
      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id} className={u.is_active ? "" : "opacity-60"}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{u.name}</span>
              <Badge tone={u.role === "ADMIN" ? "violet" : u.role === "BUYER" ? "blue" : "gray"}>{ROLE_LABEL[u.role]}</Badge>
              {!u.is_active && <Badge tone="red">заблокирован</Badge>}
              <span className="text-xs text-slate-500">логин {u.login} · последний вход {fmtDateTime(u.last_login_at)} · заказов {u.orders}</span>
              <span className="ml-auto flex gap-2">
                <Link href={`/settings?tab=audit&user=${u.id}`} className="text-xs text-brand-700 hover:underline">действия</Link>
                {u.id !== me.id && (
                  <>
                    <ConfirmButton action={resetPasswordAction} question="Сбросить пароль?" variant="secondary" hidden={{ id: u.id }}>Сбросить пароль</ConfirmButton>
                    <ConfirmButton action={toggleBlockAction} question={u.is_active ? "Заблокировать и завершить сеансы?" : "Разблокировать?"} variant={u.is_active ? "danger" : "secondary"} hidden={{ id: u.id }}>
                      {u.is_active ? "Заблокировать" : "Разблокировать"}
                    </ConfirmButton>
                  </>
                )}
              </span>
            </div>
            {u.suppliers && <p className="mb-2 text-xs text-slate-500">Поставщики: {u.suppliers}</p>}
            <ActionForm action={updateUserAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <input type="hidden" name="id" value={u.id} />
              <Field label="ФИО" className="lg:col-span-2"><Input name="name" defaultValue={u.name} /></Field>
              <Field label="Роль"><Select name="role" defaultValue={u.role} options={roleOptions} /></Field>
              <Field label="Должность"><Input name="position" defaultValue={u.position ?? ""} /></Field>
              <Field label="Телефон"><Input name="phone" defaultValue={u.phone ?? ""} /></Field>
              <Field label="Email"><Input name="email" defaultValue={u.email ?? ""} /></Field>
              <PermsEditor user={u} />
              <div className="flex items-end"><SubmitButton size="sm" variant="secondary">Сохранить</SubmitButton></div>
            </ActionForm>
          </Card>
        ))}
      </div>
      <Card title="Права ролей по умолчанию" className="mt-4">
        <ul className="space-y-1 text-sm">
          {Object.entries(ROLE_DEFAULTS).map(([k, r]) => (
            <li key={k}><b>{r.name}:</b> {k === "ADMIN" ? "все права (у конкретного руководителя можно снять любые, кроме последнего права управлять пользователями)" : r.perms.map((p) => PERM_LABELS[p]).join("; ") || "только просмотр (своих данных и справочников)"}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
