import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { fmtDate, fmtDateTime, fmtMoney, orderNo } from "@/lib/format";
import { storageKind } from "@/lib/storage";
import { Alert, Badge, Card, cn, Empty, Field, Input, PageHeader, Select, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { ChangesView } from "@/components/blocks";
import { Combobox } from "@/components/combobox";
import { FDate, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, type SP } from "@/components/list";
import { mergeRefAction, restoreRecordAction, rollbackImportAction, saveRefAction, saveSettingsAction, toggleRefAction, uploadImportAction } from "./actions";

export const metadata = { title: "Настройки" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const tabs = [
    ...(can(u, PERMS.importRun) ? [{ key: "import", label: "Импорт Excel" }] : []),
    ...(can(u, PERMS.settingsEdit) ? [{ key: "refs", label: "Справочники" }] : []),
    ...(can(u, PERMS.auditView) ? [{ key: "audit", label: "Журнал действий" }] : []),
    ...(can(u, PERMS.deleteRecords) ? [{ key: "deleted", label: "Удалённые" }] : []),
    ...(can(u, PERMS.settingsEdit) ? [{ key: "params", label: "Параметры и резервные копии" }] : []),
  ];
  if (!tabs.length) return <Alert tone="red">Недостаточно прав</Alert>;
  const tab = tabs.some((t) => t.key === qp(sp, "tab")) ? qp(sp, "tab") : tabs[0].key;
  return (
    <>
      <PageHeader title="Настройки" />
      <Tabs base="/settings" current={tab} tabs={tabs} />
      {tab === "import" && <ImportTab />}
      {tab === "refs" && <RefsTab />}
      {tab === "audit" && <AuditTab sp={sp} />}
      {tab === "deleted" && <DeletedTab />}
      {tab === "params" && <ParamsTab />}
    </>
  );
}

async function ImportTab() {
  const batches = await db.select({ b: schema.importBatches, who: schema.users.name }).from(schema.importBatches).innerJoin(schema.users, eq(schema.users.id, schema.importBatches.createdById)).orderBy(desc(schema.importBatches.createdAt)).limit(30);
  return (
    <div className="space-y-4">
      <Card title="Загрузить файл учёта (.xlsx)">
        <p className="mb-3 text-sm text-slate-600">
          Файл будет разобран без записи в базу. Вы увидите распознанные листы, количество поставщиков, товаров и заказов, дубли, ошибки и сверку с итогами Excel. Импорт выполняется только после подтверждения, повторная загрузка того же файла не задвоит заказы.
        </p>
        <ActionForm action={uploadImportAction} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".xlsx" required className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
          <SubmitButton>Разобрать файл</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="История импортов" pad={false}>
        {batches.length === 0 ? <Empty>Импортов не было</Empty> : (
          <Table>
            <thead><tr><Th>Когда</Th><Th>Файл</Th><Th>Кто</Th><Th>Статус</Th><Th>Итог</Th><Th /></tr></thead>
            <tbody>
              {batches.map(({ b, who }) => {
                const s = b.summary as Record<string, number> | null;
                return (
                  <tr key={b.id}>
                    <Td>{fmtDateTime(b.createdAt)}</Td>
                    <Td><Link className="text-brand-700 hover:underline" href={`/settings/import/${b.id}`}>{b.fileName}</Link></Td>
                    <Td>{who}</Td>
                    <Td><Badge tone={b.status === "done" ? "green" : b.status === "preview" ? "amber" : "gray"}>{{ done: "выполнен", preview: "предпросмотр", rolled_back: "отменён", failed: "ошибка" }[b.status] ?? b.status}</Badge></Td>
                    <Td className="text-xs">{s ? `заказов ${s.orders}, поставок ${s.deliveries}, оплат ${(s.payments ?? 0) + (s.advances ?? 0)}` : "—"}</Td>
                    <Td>{b.status === "done" && <ConfirmButton action={rollbackImportAction} question="Удалить всё, что создал этот импорт?" hidden={{ id: b.id }}>Откатить</ConfirmButton>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

const ENTITY_LABEL: Record<string, string> = { legal: "Юрлицо", direction: "Направление", contract: "Договор", order: "Заказ", delivery: "Поставка", payment: "Оплата", supplier: "Поставщик", product: "Товар", task: "Задача", user: "Пользователь", import: "Импорт", settings: "Настройки" };
const ACTION_LABEL: Record<string, string> = { create: "создание", update: "изменение", delete: "удаление", status: "статус", login: "вход", import: "импорт", rollback: "откат", restore: "восстановление", merge: "объединение", upload: "файл", delivery: "поставка", payment: "оплата" };

async function AuditTab({ sp }: { sp: SP }) {
  const { page, limit, offset } = pageParams(sp, 100);
  const w = [sql`TRUE`];
  const user = qp(sp, "user");
  if (user) w.push(sql`l.user_id = ${user}`);
  const et = qp(sp, "entity");
  if (et) w.push(sql`l.entity_type = ${et}`);
  const ac = qp(sp, "action");
  if (ac) w.push(sql`l.action = ${ac}`);
  const from = qp(sp, "from");
  if (from) w.push(sql`l.created_at >= ${from}::date`);
  const to = qp(sp, "to");
  if (to) w.push(sql`l.created_at < ${to}::date + 1`);
  const q = qp(sp, "q");
  if (q) w.push(sql`(l.summary ILIKE ${"%" + q + "%"} OR l.changes::text ILIKE ${"%" + q + "%"})`);
  const [res, users] = await Promise.all([
    db.execute(sql`SELECT l.*, u.name AS who, COUNT(*) OVER()::int AS total FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id WHERE ${sql.join(w, sql` AND `)} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(schema.users.name),
  ]);
  const rows = res.rows as { id: string; created_at: string; who: string | null; action: string; entity_type: string; entity_id: string; summary: string; changes: unknown; ip: string | null; total: number }[];
  const href = (t: string, id: string) => ({ order: `/orders/${id}`, supplier: `/suppliers/${id}`, product: `/products/${id}`, task: `/tasks/${id}`, import: `/settings/import/${id}` })[t];
  return (
    <>
      <FilterBar base="/settings" sp={sp} keep={["tab"]}>
        <SearchInput sp={sp} placeholder="Текст, сумма, название" />
        <FSelect searchable name="user" sp={sp} placeholder="Все сотрудники" options={users.map((x) => ({ value: x.id, label: x.name }))} />
        <FSelect name="entity" sp={sp} placeholder="Все объекты" options={Object.entries(ENTITY_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        <FSelect name="action" sp={sp} placeholder="Все действия" options={Object.entries(ACTION_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        <FDate name="from" sp={sp} label="с" />
        <FDate name="to" sp={sp} label="по" />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <Empty>Записей нет</Empty> : (
          <Table>
            <thead><tr><Th>Когда</Th><Th>Кто</Th><Th>Объект</Th><Th>Что сделано</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}{r.ip && <div className="text-slate-400">{r.ip}</div>}</Td>
                  <Td className="whitespace-nowrap">{r.who ?? "система"}</Td>
                  <Td className="whitespace-nowrap text-xs">{ENTITY_LABEL[r.entity_type] ?? r.entity_type} · {ACTION_LABEL[r.action] ?? r.action}</Td>
                  <Td>
                    {href(r.entity_type, r.entity_id) ? <Link className="hover:text-brand-700" href={href(r.entity_type, r.entity_id)!}>{r.summary}</Link> : r.summary}
                    <ChangesView changes={r.changes} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/settings" sp={sp} total={rows[0]?.total ?? 0} page={page} size={limit} />
      </Card>
    </>
  );
}

async function DeletedTab() {
  const res = await db.execute(sql`
    SELECT 'order' AS type, o.id, o.deleted_at, 'Заказ З-' || lpad(o.number::text, 5, '0') || ' · ' || s.name AS label FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.deleted_at IS NOT NULL
    UNION ALL SELECT 'supplier', id, deleted_at, 'Поставщик ' || name FROM suppliers WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'delivery', d.id, d.deleted_at, 'Поставка от ' || to_char(d.date, 'DD.MM.YYYY') || ' по заказу З-' || lpad(o.number::text, 5, '0') FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id WHERE d.deleted_at IS NOT NULL
    UNION ALL SELECT 'payment', p.id, p.deleted_at, 'Оплата ' || p.amount || ' ₽ от ' || COALESCE(to_char(p.date, 'DD.MM.YYYY'), '—') FROM payments p WHERE p.deleted_at IS NOT NULL
    ORDER BY 3 DESC LIMIT 200`);
  const rows = res.rows as { type: string; id: string; deleted_at: string; label: string }[];
  return (
    <Card title="Удалённые записи — можно восстановить" pad={false}>
      {rows.length === 0 ? <Empty>Корзина пуста</Empty> : (
        <Table>
          <thead><tr><Th>Удалено</Th><Th>Запись</Th><Th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{fmtDateTime(r.deleted_at)}</Td>
                <Td>{r.label}</Td>
                <Td>
                  <ActionForm action={restoreRecordAction}>
                    <input type="hidden" name="type" value={r.type} />
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton size="sm" variant="secondary">Восстановить</SubmitButton>
                  </ActionForm>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ParamsTab() {
  const rows = await db.select().from(schema.settings);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const counts = (await db.execute(sql`SELECT (SELECT COUNT(*) FROM purchase_orders)::int o, (SELECT COUNT(*) FROM deliveries)::int d, (SELECT COUNT(*) FROM payments)::int p, (SELECT COUNT(*) FROM documents)::int f`)).rows[0] as Record<string, number>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Расчёты">
        <ActionForm action={saveSettingsAction} className="space-y-3">
          <Field label="Период средневзвешенной цены «6 месяцев»">
            <Select name="priceWindowMode" defaultValue={String(s.priceWindowMode ?? "rolling")} options={[{ value: "rolling", label: "Скользящий: от той же даты 6 месяцев назад до сегодня" }, { value: "calendar", label: "6 полных календарных месяцев (без текущего)" }]} />
          </Field>
          <Field label="Срок поставки по умолчанию, дней" hint="Подставляется в плановую дату новых заказов; по ней считаются просрочки">
            <Input name="defaultLeadDays" type="number" min={0} max={365} defaultValue={String(s.defaultLeadDays ?? 30)} />
          </Field>
          <SubmitButton>Сохранить</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Резервные копии">
        <p className="mb-3 text-sm text-slate-600">
          База данных: {process.env.DATABASE_URL?.includes("supabase") ? "Supabase (ежедневные копии делает Supabase на платных тарифах)" : "PostgreSQL"}. Файлы: {storageKind === "supabase" ? "Supabase Storage" : "локальная папка"}.
        </p>
        <p className="mb-3 text-sm text-slate-600">
          В базе: заказов {counts.o}, поставок {counts.d}, оплат {counts.p}, документов {counts.f}. Полная выгрузка всех таблиц — ручная копия на случай сбоя, хранить вне системы.
        </p>
        <a href="/api/backup" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">⬇ Скачать полную копию данных (Excel)</a>
      </Card>
    </div>
  );
}

void fmtDate;
void fmtMoney;
void orderNo;

/** Наши юрлица и направления: добавление, переименование, скрытие, объединение дублей */
async function RefsTab() {
  const [legal, dirs] = await Promise.all([
    db.execute(sql`SELECT l.id, l.name, l.short_name, l.inn, l.is_active,
        (SELECT count(*) FROM purchase_orders o WHERE o.legal_entity_id = l.id AND o.deleted_at IS NULL)::int AS orders,
        (SELECT count(*) FROM payments p WHERE p.legal_entity_id = l.id AND p.deleted_at IS NULL)::int AS payments
      FROM legal_entities l ORDER BY l.is_active DESC, COALESCE(l.short_name, l.name)`),
    db.execute(sql`SELECT d.id, d.name, d.is_active,
        (SELECT count(*) FROM purchase_orders o WHERE o.direction_id = d.id AND o.deleted_at IS NULL)::int AS orders,
        (SELECT count(*) FROM purchase_order_items i WHERE i.direction_id = d.id)::int AS items
      FROM directions d ORDER BY d.is_active DESC, d.name`),
  ]);
  type L = { id: string; name: string; short_name: string | null; inn: string | null; is_active: boolean; orders: number; payments: number };
  type D = { id: string; name: string; is_active: boolean; orders: number; items: number };
  const L = legal.rows as L[];
  const D = dirs.rows as D[];
  const cell = "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <Card title="Наши юрлица">
        <p className="mb-3 text-sm text-slate-600">
          В списках заказов и оплат показывается <b>короткое название</b> («Добрынин»), полное — в подсказке и в выгрузках. Скрытое юрлицо не предлагается в новых заказах, старые заказы не меняются. Дубль можно объединить с основным: все его заказы и оплаты перейдут туда.
        </p>
        <div className="space-y-2">
          {L.map((l) => (
            <div key={l.id} className={cn("flex flex-wrap items-start gap-2 rounded-lg border p-2", l.is_active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50")}>
              <ActionForm action={saveRefAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="kind" value="legal" />
                <input type="hidden" name="id" value={l.id} />
                <input name="shortName" defaultValue={l.short_name ?? ""} placeholder="Короткое" className={cn(cell, "w-36")} />
                <input name="name" defaultValue={l.name} required placeholder="Полное название" className={cn(cell, "w-72")} />
                <input name="inn" defaultValue={l.inn ?? ""} placeholder="ИНН" inputMode="numeric" className={cn(cell, "w-36")} />
                <SubmitButton size="sm" variant="secondary">Сохранить</SubmitButton>
              </ActionForm>
              <span className="self-center text-xs text-slate-500">заказов {l.orders} · оплат {l.payments}{!l.is_active && " · скрыто"}</span>
              <div className="ml-auto flex flex-wrap items-start gap-2">
                <ActionForm action={toggleRefAction}>
                  <input type="hidden" name="kind" value="legal" />
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton size="sm" variant="ghost">{l.is_active ? "Скрыть" : "Показывать"}</SubmitButton>
                </ActionForm>
                <MergeForm kind="legal" id={l.id} options={L.filter((x) => x.id !== l.id).map((x) => ({ value: x.id, label: x.short_name || x.name, hint: x.short_name ? x.name : null }))} />
              </div>
            </div>
          ))}
        </div>
        <ActionForm action={saveRefAction} resetOnOk className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="kind" value="legal" />
          <input name="shortName" placeholder="Короткое: Елисеев" className={cn(cell, "w-40")} />
          <input name="name" required placeholder="Полное: ИП Елисеев Максим Анатольевич" className={cn(cell, "w-80")} />
          <input name="inn" placeholder="ИНН" inputMode="numeric" className={cn(cell, "w-36")} />
          <SubmitButton size="sm">+ Добавить юрлицо</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Направления">
        <p className="mb-3 text-sm text-slate-600">При импорте Excel новые направления не создаются: «ПП - Поля», «ПП-осн» и т. п. относятся к «ПП», незнакомое направление остаётся пустым.</p>
        <div className="space-y-2">
          {D.map((d) => (
            <div key={d.id} className={cn("flex flex-wrap items-start gap-2 rounded-lg border p-2", d.is_active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50")}>
              <ActionForm action={saveRefAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="kind" value="direction" />
                <input type="hidden" name="id" value={d.id} />
                <input name="name" defaultValue={d.name} required className={cn(cell, "w-56")} />
                <SubmitButton size="sm" variant="secondary">Сохранить</SubmitButton>
              </ActionForm>
              <span className="self-center text-xs text-slate-500">заказов {d.orders} · позиций {d.items}{!d.is_active && " · скрыто"}</span>
              <div className="ml-auto flex flex-wrap items-start gap-2">
                <ActionForm action={toggleRefAction}>
                  <input type="hidden" name="kind" value="direction" />
                  <input type="hidden" name="id" value={d.id} />
                  <SubmitButton size="sm" variant="ghost">{d.is_active ? "Скрыть" : "Показывать"}</SubmitButton>
                </ActionForm>
                <MergeForm kind="direction" id={d.id} options={D.filter((x) => x.id !== d.id).map((x) => ({ value: x.id, label: x.name }))} />
              </div>
            </div>
          ))}
        </div>
        <ActionForm action={saveRefAction} resetOnOk className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="kind" value="direction" />
          <input name="name" required placeholder="Название направления" className={cn(cell, "w-56")} />
          <SubmitButton size="sm">+ Добавить направление</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

function MergeForm({ kind, id, options }: { kind: "legal" | "direction"; id: string; options: { value: string; label: string; hint?: string | null }[] }) {
  if (!options.length) return null;
  return (
    <ActionForm action={mergeRefAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <Combobox name="target" options={options} placeholder="Объединить с…" className="w-48" />
      <SubmitButton size="sm" variant="secondary">Объединить</SubmitButton>
    </ActionForm>
  );
}
