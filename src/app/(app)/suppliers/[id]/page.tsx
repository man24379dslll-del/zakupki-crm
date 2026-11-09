import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { ITEM_STATS, listOrders, orderScope } from "@/lib/services/orders";
import { supplierList } from "@/lib/services/suppliers";
import { getWindowMode, pricePoints, priceWindow, weightedStats } from "@/lib/services/prices";
import { lastAndPrev } from "@/lib/calc";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtMoney, fmtPct, fmtPrice, fmtQty, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, orderNo, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, SUPPLIER_STATUS_LABEL, SUPPLIER_STATUS_TONE, today } from "@/lib/format";
import { Alert, Badge, Card, cn, DL, Empty, LinkButton, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { CommentsBlock, DocumentsBlock, HistoryBlock } from "@/components/blocks";
import { deleteContractAction, deleteSupplierAction, saveContractAction, setSupplierBuyersAction, updateSupplierAction } from "../actions";
import { deleteDocumentAction } from "@/app/actions/documents";
import { CONTRACT_TONE, contractState, contractTitle, type ContractState } from "@/lib/services/contracts";
import { ContractFields, SupplierFields } from "../form";
import { registerPaymentAction } from "../../orders/actions";
import { PaymentFormFields } from "../../payments/fields";

export const metadata = { title: "Поставщик" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? "info";
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [s] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, id), isNull(schema.suppliers.deletedAt)));
  if (!s) notFound();
  const [stats] = await supplierList(u, [sql`s.id = ${id}`]);
  const buyers = await db.select({ id: schema.users.id, name: schema.users.name, isPrimary: schema.supplierBuyers.isPrimary }).from(schema.supplierBuyers).innerJoin(schema.users, eq(schema.users.id, schema.supplierBuyers.userId)).where(eq(schema.supplierBuyers.supplierId, id));
  const isMine = buyers.some((b) => b.id === u.id);
  const debtShip = Number(stats.delivered_amount) - Number(stats.paid_orders) - Number(stats.advances);
  const debtOrder = Number(stats.amount) - Number(stats.paid_orders) - Number(stats.advances);
  const base = `/suppliers/${id}`;
  const canEdit = can(u, PERMS.suppliersEdit);
  const d = today();
  const contracts = await db
    .execute(sql`SELECT c.id, c.number, c.date::text AS date, c.valid_until::text AS valid_until, c.note
      FROM supplier_contracts c WHERE c.supplier_id = ${id} AND c.deleted_at IS NULL
      ORDER BY c.valid_until DESC NULLS FIRST, c.date DESC NULLS LAST, c.created_at DESC`)
    .then((r) => r.rows as ContractRow[]);
  const current = contracts[0] ?? null;
  const cState = contractState(current, d);

  return (
    <>
      <PageHeader help={"suppliers"}
        back={{ href: "/suppliers", label: "Поставщики" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.name} <Badge tone={SUPPLIER_STATUS_TONE[s.status]}>{SUPPLIER_STATUS_LABEL[s.status]}</Badge>
            <Link href={`${base}?tab=info#contracts`} title={contractTitle(current, d)}>
              <Badge tone={CONTRACT_TONE[cState]}>{contractBadge(current, cState)}</Badge>
            </Link>
          </span>
        }
        subtitle={[s.legalName, s.inn && `ИНН ${s.inn}`, buyers.length ? `Ответственные: ${buyers.map((b) => b.name).join(", ")}` : "Ответственный не назначен"].filter(Boolean).join(" · ")}
        actions={
          <>
            <LinkButton href={`/suppliers/${id}/act`}>Акт сверки</LinkButton>
            {can(u, PERMS.ordersEdit) && (
              <LinkButton href={`/orders/new?supplier=${id}`} variant="primary">
                + Заказ
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Заказов" value={stats.orders} sub={`${stats.active_orders} активных`} />
        <Stat label="Объём закупок" value={fmtMoney(stats.amount)} />
        <Stat label="Поставлено на сумму" value={fmtMoney(stats.delivered_amount)} />
        <Stat label="Оплачено" value={fmtMoney(Number(stats.paid_orders) + Number(stats.advances))} sub={Number(stats.advances) ? `в т.ч. авансы без счёта ${fmtMoney(stats.advances)}` : undefined} />
        <Stat label="Долг по отгрузке" value={fmtMoney(debtShip)} sub={debtShip < 0 ? "аванс у поставщика" : `по заказам: ${fmtMoney(debtOrder)}`} tone={debtShip > 0 ? "amber" : undefined} />
      </div>
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "info", label: "Общая информация" },
          { key: "orders", label: "Заказы", count: stats.orders },
          { key: "deliveries", label: "Поставки" },
          { key: "prices", label: "История цен" },
          { key: "payments", label: "Оплаты и долги" },
          { key: "plan", label: "План поставок" },
          { key: "docs", label: "Документы" },
          { key: "comments", label: "Комментарии" },
          { key: "history", label: "Изменения" },
        ]}
      />
      {tab === "info" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card title="Карточка" className="xl:col-span-2">
            {canEdit ? (
              <ActionForm action={updateSupplierAction}>
                <input type="hidden" name="id" value={id} />
                <SupplierFields s={s} />
                <div className="mt-4 flex gap-2">
                  <SubmitButton>Сохранить</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <DL
                items={[
                  ["Юридическое лицо", s.legalName],
                  ["ИНН", s.inn],
                  ["Контактное лицо", s.contactPerson],
                  ["Телефон", s.phone],
                  ["Email", s.email],
                  ["Адрес", s.address],
                  ["Направление деятельности", s.activity],
                  ["Начало сотрудничества", s.startedAt ? fmtDate(s.startedAt) : null],
                  ["Банковские реквизиты", s.bankDetails],
                  ["Комментарий", s.comment],
                ]}
              />
            )}
          </Card>
          <div className="space-y-4">
            <ContractsCard supplierId={id} contracts={contracts} canEdit={canEdit} today={d} />
            <BuyersCard id={id} buyers={buyers} canManage={can(u, PERMS.ordersViewAll)} />
            {can(u, PERMS.deleteRecords) && (
              <Card title="Опасная зона">
                <ConfirmButton action={deleteSupplierAction} question="Удалить поставщика?" hidden={{ id }}>
                  Удалить поставщика
                </ConfirmButton>
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === "orders" && <OrdersTab id={id} u={u} />}
      {tab === "deliveries" && <DeliveriesTab id={id} u={u} />}
      {tab === "prices" && <PricesTab id={id} />}
      {tab === "payments" && <PaymentsTab id={id} u={u} canSeeAdv={can(u, PERMS.ordersViewAll) || isMine} />}
      {tab === "plan" && <PlanTab id={id} u={u} />}
      {tab === "docs" && <DocumentsBlock entityType="supplier" entityId={id} canEdit={u.role !== "VIEWER"} />}
      {tab === "comments" && <CommentsBlock entityType="supplier" entityId={id} canEdit={u.role !== "VIEWER"} />}
      {tab === "history" && <HistoryBlock entityType="supplier" entityId={id} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;
type ContractRow = { id: string; number: string | null; date: string | null; valid_until: string | null; note: string | null };

function contractBadge(c: ContractRow | null, st: ContractState) {
  if (st === "none") return "нет договора";
  if (st === "expired") return "договор истёк";
  if (st === "expiring") return `договор истекает ${fmtDate(c!.valid_until)}`;
  return c!.valid_until ? `договор до ${fmtDate(c!.valid_until)}` : "договор бессрочный";
}

/** Договоры: актуальный сверху, история ниже; у каждого — файлы, изменение, удаление */
async function ContractsCard({ supplierId, contracts, canEdit, today: d }: { supplierId: string; contracts: ContractRow[]; canEdit: boolean; today: string }) {
  const files = contracts.length
    ? await db
        .select()
        .from(schema.documents)
        .where(and(eq(schema.documents.entityType, "contract"), inArray(schema.documents.entityId, contracts.map((c) => c.id)), isNull(schema.documents.deletedAt)))
        .orderBy(asc(schema.documents.createdAt))
    : [];
  const fields = (c?: ContractRow) => <ContractFields compact c={c ? { number: c.number, date: c.date, validUntil: c.valid_until, note: c.note } : undefined} />;
  return (
    <Card title={<span id="contracts" className="scroll-mt-20">Договоры ({contracts.length})</span>}>
      {contracts.length === 0 && <p className="mb-3 text-sm text-slate-500">Договор не прикреплён</p>}
      <ul className="space-y-3">
        {contracts.map((c, i) => {
          const st = contractState(c, d);
          const own = files.filter((f) => f.entityId === c.id);
          return (
            <li key={c.id} className={cn("rounded-lg border p-3", i === 0 ? "border-slate-200" : "border-dashed border-slate-200 bg-slate-50/60")}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{contractTitle(c, d)}</span>
                {i === 0 ? <Badge tone={CONTRACT_TONE[st]}>{{ none: "", ok: "действует", expiring: "истекает", expired: "истёк" }[st]}</Badge> : <Badge>прежний</Badge>}
              </div>
              {c.note && <div className="mt-1 text-xs text-slate-600">{c.note}</div>}
              <ul className="mt-2 space-y-1">
                {own.length === 0 && <li className="text-xs text-slate-400">Файлов нет</li>}
                {own.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                    <a href={`/api/documents/${f.id}`} target="_blank" className="truncate text-brand-700 hover:underline">📄 {f.fileName}</a>
                    {canEdit && <ConfirmButton action={deleteDocumentAction} question="Удалить файл?" hidden={{ id: f.id }}>✕</ConfirmButton>}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">Изменить или добавить файлы</summary>
                  <ActionForm action={saveContractAction} className="mt-2">
                    <input type="hidden" name="supplierId" value={supplierId} />
                    <input type="hidden" name="contractId" value={c.id} />
                    {fields(c)}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <SubmitButton size="sm">Сохранить</SubmitButton>
                      <ConfirmButton action={deleteContractAction} question="Удалить договор вместе с файлами?" hidden={{ id: c.id }}>Удалить договор</ConfirmButton>
                    </div>
                  </ActionForm>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <details className="mt-3" open={contracts.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">+ {contracts.length ? "Новый договор или допсоглашение" : "Прикрепить договор"}</summary>
          <ActionForm action={saveContractAction} resetOnOk className="mt-2">
            <input type="hidden" name="supplierId" value={supplierId} />
            {fields()}
            <div className="mt-3">
              <SubmitButton size="sm">Сохранить договор</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}

async function BuyersCard({ id, buyers, canManage }: { id: string; buyers: { id: string; name: string; isPrimary: boolean }[]; canManage: boolean }) {
  const opts = canManage ? await selectOptions() : null;
  return (
    <Card title="Ответственные закупщики">
      {buyers.length === 0 ? <p className="text-sm text-slate-500">Не назначены</p> : (
        <ul className="mb-3 space-y-1 text-sm">
          {buyers.map((b) => (
            <li key={b.id}>
              {b.name} {b.isPrimary && <Badge tone="blue">основной</Badge>}
            </li>
          ))}
        </ul>
      )}
      {opts && (
        <ActionForm action={setSupplierBuyersAction}>
          <input type="hidden" name="id" value={id} />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {opts.buyers.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="buyer" value={b.id} defaultChecked={buyers.some((x) => x.id === b.id)} />
                <span className="flex-1">{b.name}</span>
                <input type="radio" name="primary" value={b.id} defaultChecked={buyers.find((x) => x.isPrimary)?.id === b.id} title="Основной" />
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Кружок — основной ответственный</p>
          <div className="mt-2">
            <SubmitButton size="sm">Сохранить</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}

async function OrdersTab({ id, u }: { id: string; u: U }) {
  const rows = await listOrders(u, { where: [sql`o.supplier_id = ${id}`], limit: 300 });
  return (
    <Card pad={false}>
      {rows.length === 0 ? <Empty>Заказов нет</Empty> : (
        <Table>
          <thead>
            <tr><Th>№</Th><Th>Дата</Th><Th>Счёт</Th><Th>Товары</Th><Th right>Сумма</Th><Th right>Поставлено</Th><Th right>Оплачено</Th><Th>Статус</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link className="text-brand-700 hover:underline" href={`/orders/${r.id}`}>{orderNo(r.number)}</Link></Td>
                <Td>{fmtDate(r.order_date)}</Td>
                <Td>{r.invoice_number ?? "—"}</Td>
                <Td className="max-w-72 truncate text-xs text-slate-500">{r.products}</Td>
                <Td right>{fmtMoney(r.amount)}</Td>
                <Td right>{fmtPct(Number(r.qty) ? (Number(r.delivered) / Number(r.qty)) * 100 : 0)}</Td>
                <Td right>{fmtMoney(r.paid)}</Td>
                <Td><Badge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Badge>{r.overdue && <Badge tone="red">просрочен</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function DeliveriesTab({ id, u }: { id: string; u: U }) {
  const res = await db.execute(sql`
    SELECT d.date, d.date_assumed, d.waybill_number, o.id AS order_id, o.number, pr.name AS product, di.qty, di.price
    FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id JOIN delivery_items di ON di.delivery_id = d.id JOIN products pr ON pr.id = di.product_id
    WHERE d.supplier_id = ${id} AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND ${orderScope(u)}
    ORDER BY d.date DESC, o.number DESC LIMIT 500`);
  const rows = res.rows as { date: string; date_assumed: boolean; waybill_number: string | null; order_id: string; number: number; product: string; qty: string; price: string | null }[];
  return (
    <Card pad={false}>
      {rows.length === 0 ? <Empty>Поставок нет</Empty> : (
        <Table>
          <thead><tr><Th>Дата</Th><Th>Заказ</Th><Th>Товар</Th><Th right>Кол-во</Th><Th right>Цена</Th><Th right>Сумма</Th><Th>Накладная</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td>{fmtDate(r.date)}{r.date_assumed && " *"}</Td>
                <Td><Link className="text-brand-700 hover:underline" href={`/orders/${r.order_id}`}>{orderNo(r.number)}</Link></Td>
                <Td>{r.product}</Td>
                <Td right>{fmtQty(r.qty)}</Td>
                <Td right>{fmtPrice(r.price)}</Td>
                <Td right>{r.price ? fmtMoney(Number(r.qty) * Number(r.price)) : "—"}</Td>
                <Td>{r.waybill_number ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function PricesTab({ id }: { id: string }) {
  const prods = await db.select({ id: schema.productSuppliers.productId, name: schema.products.name }).from(schema.productSuppliers).innerJoin(schema.products, eq(schema.products.id, schema.productSuppliers.productId)).where(eq(schema.productSuppliers.supplierId, id)).orderBy(asc(schema.products.name));
  const w = priceWindow(6, await getWindowMode());
  const pts = await pricePoints(prods.map((p) => p.id));
  const rows = prods
    .map((p) => {
      const mine = pts.filter((x) => x.productId === p.id && x.supplierId === id);
      const mineWin = mine.filter((x) => x.date >= w.from && x.date <= w.to);
      const allWin = pts.filter((x) => x.productId === p.id && x.date >= w.from && x.date <= w.to);
      const s = weightedStats(mineWin);
      const market = weightedStats(allWin);
      const lp = lastAndPrev(mine);
      return { ...p, s, market, lp, others: new Set(allWin.map((x) => x.supplierId)).size > 1 };
    })
    .filter((r) => r.lp.lastPrice !== null || r.s.qty > 0);
  return (
    <Card pad={false} title={`Цены за 6 месяцев (${fmtDate(w.from)} — ${fmtDate(w.to)})`}>
      {rows.length === 0 ? <Empty>Нет поставок с ценой</Empty> : (
        <Table>
          <thead><tr><Th>Товар</Th><Th right>Последняя цена</Th><Th right>Изменение</Th><Th right>Средневзв. 6 мес.</Th><Th right>Мин / макс</Th><Th right>Поставлено, 6 мес.</Th><Th right>Ср. по всем поставщикам</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/products/${r.id}`} className="text-brand-700 hover:underline">{r.name}</Link></Td>
                <Td right>{fmtPrice(r.lp.lastPrice)}<div className="text-xs text-slate-400">{fmtDate(r.lp.lastDate)}</div></Td>
                <Td right className={r.lp.change && r.lp.change > 0 ? "text-rose-600" : r.lp.change && r.lp.change < 0 ? "text-emerald-700" : ""}>{r.lp.change === null ? "—" : `${r.lp.change > 0 ? "+" : ""}${r.lp.change.toFixed(1)}%`}</Td>
                <Td right>{r.s.avg === null ? "Нет данных" : fmtPrice(r.s.avg)}</Td>
                <Td right>{r.s.min === null ? "—" : `${fmtPrice(r.s.min)} / ${fmtPrice(r.s.max)}`}</Td>
                <Td right>{fmtQty(r.s.qty)}</Td>
                <Td right>{r.others ? fmtPrice(r.market.avg) : <span className="text-xs text-slate-400">единственный</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function PaymentsTab({ id, u, canSeeAdv }: { id: string; u: U; canSeeAdv: boolean }) {
  const res = await db.execute(sql`
    SELECT p.id, p.date, p.amount, p.type, p.method, p.doc_number, p.comment, o.id AS order_id, o.number
    FROM payments p LEFT JOIN purchase_orders o ON o.id = p.order_id
    WHERE p.supplier_id = ${id} AND p.deleted_at IS NULL
      AND ((p.order_id IS NOT NULL AND o.deleted_at IS NULL AND ${orderScope(u)}) OR (p.order_id IS NULL AND ${canSeeAdv}))
    ORDER BY p.date DESC NULLS FIRST`);
  const rows = res.rows as { id: string; date: string | null; amount: string; type: string; method: string; doc_number: string | null; comment: string | null; order_id: string | null; number: number | null }[];
  const orders = await listOrders(u, { where: [sql`o.supplier_id = ${id}`, sql`o.status <> 'CANCELLED'`], limit: 300 });
  const debtRows = orders.filter((o) => Math.abs(Number(o.amount) - Number(o.paid)) > 0.009 || Math.abs(Number(o.delivered_amount) - Number(o.paid)) > 0.009);
  const opts = can(u, PERMS.ordersEdit) && canSeeAdv ? await selectOptions() : null;
  return (
    <div className="space-y-4">
      <Card title="Задолженность по заказам" pad={false}>
        {debtRows.length === 0 ? <Empty>Расчёты по всем заказам закрыты</Empty> : (
          <Table>
            <thead><tr><Th>Заказ</Th><Th right>Сумма заказа</Th><Th right>Поставлено на</Th><Th right>Оплачено</Th><Th right>% оплаты</Th><Th right>Долг по заказу</Th><Th right>Долг по отгрузке</Th></tr></thead>
            <tbody>
              {debtRows.map((o) => (
                <tr key={o.id}>
                  <Td><Link className="text-brand-700 hover:underline" href={`/orders/${o.id}`}>{orderNo(o.number)}</Link><span className="ml-1 text-xs text-slate-500">{fmtDate(o.order_date)}</span></Td>
                  <Td right>{fmtMoney(o.amount)}</Td>
                  <Td right>{fmtMoney(o.delivered_amount)}</Td>
                  <Td right>{fmtMoney(o.paid)}</Td>
                  <Td right>{Number(o.amount) ? fmtPct((Number(o.paid) / Number(o.amount)) * 100) : "—"}</Td>
                  <Td right>{fmtMoney(Number(o.amount) - Number(o.paid))}</Td>
                  <Td right className={Number(o.delivered_amount) - Number(o.paid) > 0 ? "text-amber-700" : "text-emerald-700"}>{fmtMoney(Number(o.delivered_amount) - Number(o.paid))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title={`Платежи (${rows.length})`} pad={false}>
        {rows.length === 0 ? <Empty>Платежей нет</Empty> : (
          <Table>
            <thead><tr><Th>Дата</Th><Th>Заказ</Th><Th>Тип</Th><Th right>Сумма</Th><Th>№ ПП</Th><Th>Комментарий</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td>{p.date ? fmtDate(p.date) : <Badge tone="amber">без даты</Badge>}</Td>
                  <Td>{p.order_id ? <Link className="text-brand-700 hover:underline" href={`/orders/${p.order_id}`}>{orderNo(p.number!)}</Link> : <Badge tone="violet">аванс без счёта</Badge>}</Td>
                  <Td>{PAYMENT_TYPE_LABEL[p.type]}{p.method === "CASH" && ` (${PAYMENT_METHOD_LABEL.CASH})`}</Td>
                  <Td right>{fmtMoney(p.amount, 2)}</Td>
                  <Td>{p.doc_number ?? "—"}</Td>
                  <Td className="max-w-80 text-xs text-slate-500">{p.comment}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {opts && (
        <Card title="Внести аванс без привязки к заказу">
          <Alert tone="blue">Аванс учитывается в сальдо поставщика, но не в долге по конкретному заказу. Если платёж относится к счёту — вносите его на странице заказа.</Alert>
          <ActionForm action={registerPaymentAction} resetOnOk className="mt-3">
            <input type="hidden" name="supplierId" value={id} />
            <PaymentFormFields legal={opt(opts.legal)} defaultType="ADVANCE" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

/** План поставок поставщика: что ждём по заказам (срок позиции — свой или общий) + график из Excel (не факт) */
async function PlanTab({ id, u }: { id: string; u: U }) {
  const d = today();
  const expected = (
    await db.execute(sql`
      WITH ${ITEM_STATS}
      SELECT ist.due_date::text AS day, poi.planned_delivery_date IS NOT NULL AS own, pr.id AS product_id, pr.name AS product, pr.unit,
        (ist.qty - ist.delivered)::float AS qty, o.id AS order_id, o.number
      FROM purchase_orders o
      JOIN item_stats ist ON ist.order_id = o.id AND NOT ist.is_closed AND ist.qty > ist.delivered
      JOIN purchase_order_items poi ON poi.id = ist.id
      JOIN products pr ON pr.id = ist.product_id
      WHERE o.supplier_id = ${id} AND o.deleted_at IS NULL AND ${orderScope(u)} AND o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL')
      ORDER BY ist.due_date NULLS LAST, o.number, pr.name`)
  ).rows as { day: string | null; own: boolean; product_id: string; product: string; unit: string; qty: number; order_id: string; number: number }[];
  const days = [...new Set(expected.map((e) => e.day))];
  const plan = await PlanEntries({ id });
  if (!expected.length && !plan) return <Card><Empty>Ожидаемых поставок и плана нет</Empty></Card>;
  return (
    <div className="space-y-4">
      {expected.length > 0 && (
        <Card title="Ожидаемые поставки по заказам" actions={<Link href={`/calendar?supplier=${id}`} className="text-xs font-medium text-brand-700 hover:underline">в календаре →</Link>} pad={false}>
          <Table>
            <thead><tr><Th>Товар</Th><Th right>Ждём</Th><Th>Заказ</Th><Th /></tr></thead>
            <tbody>
              {days.map((day) => {
                const list = expected.filter((e) => e.day === day);
                const late = !!day && day < d;
                return [
                  <tr key={day ?? "none"} className={late ? "bg-rose-50/60" : "bg-slate-50"}>
                    <Td colSpan={4} className="font-semibold text-slate-800">
                      {day ? fmtDate(day) : "Срок не указан"} <span className="font-normal text-slate-500">· {list.length} поз.</span> {late && <Badge tone="red">просрочено</Badge>}
                    </Td>
                  </tr>,
                  ...list.map((e, i) => (
                    <tr key={`${day}-${i}`}>
                      <Td>
                        <Link href={`/products/${e.product_id}`} className="text-slate-800 hover:text-brand-700">{e.product}</Link>
                        {e.own && <span className="ml-2 text-xs text-slate-500" title="У позиции свой срок, отличный от общего срока заказа">свой срок</span>}
                      </Td>
                      <Td right className="whitespace-nowrap font-medium">{fmtQty(e.qty)} {e.unit}</Td>
                      <Td><Link href={`/orders/${e.order_id}`} className="font-medium text-brand-700 hover:underline">{orderNo(e.number)}</Link></Td>
                      <Td><Link href={`/orders/${e.order_id}#deliver`} className="text-xs font-medium text-brand-700 hover:underline">Принять →</Link></Td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </Table>
        </Card>
      )}
      {plan}
    </div>
  );
}

async function PlanEntries({ id }: { id: string }) {
  const rows = await db
    .select({ p: schema.supplyPlanEntries, product: schema.products.name, productId: schema.products.id })
    .from(schema.supplyPlanEntries)
    .innerJoin(schema.products, eq(schema.products.id, schema.supplyPlanEntries.productId))
    .where(eq(schema.supplyPlanEntries.supplierId, id))
    .orderBy(asc(schema.products.name), asc(schema.supplyPlanEntries.weekStart));
  if (!rows.length) return null;
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byProduct.has(r.product)) byProduct.set(r.product, []);
    byProduct.get(r.product)!.push(r);
  }
  return (
    <Card title="План поставок (понедельно, не факт)" pad={false}>
      <Table>
        <thead><tr><Th>Товар</Th><Th>Статус</Th><Th>Недели и количество</Th><Th right>Итого по плану</Th><Th>Примечание</Th></tr></thead>
        <tbody>
          {[...byProduct].map(([name, rs]) => (
            <tr key={name}>
              <Td><Link className="text-brand-700 hover:underline" href={`/products/${rs[0].productId}`}>{name}</Link></Td>
              <Td className="text-xs">{rs[0].p.status ?? "—"}</Td>
              <Td className="text-xs">{rs.filter((r) => r.p.weekStart).map((r) => `${fmtDate(r.p.weekStart).slice(0, 5)}: ${fmtQty(r.p.qty)}`).join(" · ") || "—"}</Td>
              <Td right>{fmtQty(rs.reduce((a, r) => a + Number(r.p.qty ?? 0), 0))}</Td>
              <Td className="max-w-72 text-xs text-slate-500">{rs[0].p.note}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

void desc;
