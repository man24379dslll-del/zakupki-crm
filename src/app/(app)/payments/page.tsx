import Link from "next/link";
import { Fragment } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { orderScope, ORDER_STATS } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtMoney, orderNo, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { ExportLink, FDate, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, type SP } from "@/components/list";
import { ExpandableRow } from "@/components/client";

export const metadata = { title: "Оплаты" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const tab = qp(sp, "tab") || "debts";
  const opts = await selectOptions();
  return (
    <>
      <PageHeader help={"payments"}
        title="Оплаты и задолженности"
        actions={
          <>
            {tab === "log" && <ExportLink entity="payments" sp={sp} />}
            {can(u, PERMS.ordersEdit) && (
              <LinkButton href="/payments/new" variant="primary">
                + Оплата
              </LinkButton>
            )}
          </>
        }
      />
      <Tabs base="/payments" current={tab} tabs={[{ key: "debts", label: "Задолженности по поставщикам" }, { key: "log", label: "Журнал платежей" }]} />
      {tab === "debts" ? <Debts u={u} sp={sp} /> : <Log u={u} sp={sp} opts={opts} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;

async function Debts({ u, sp }: { u: U; sp: SP }) {
  // only=debt — только кому мы должны (плитка «Мы должны»), only=prepaid — у кого наши авансы
  const only = qp(sp, "only");
  // период: заказы, оформленные с … по …; поставки и оплаты по ним — по дату «по» включительно (долг на конец периода);
  // авансы без счёта — по дате платежа в пределах периода. Без дат — за всё время, как раньше.
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(qp(sp, "from")) ? qp(sp, "from") : "";
  const to = isDate(qp(sp, "to")) ? qp(sp, "to") : "";
  const fromD = from || "0001-01-01";
  const toD = to || "9999-12-31";
  const keepQs = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...extra });
    return q.size ? `/payments?${q}` : "/payments";
  };
  const adv = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
  const res = await db.execute(sql`
    WITH ${ORDER_STATS}, ${PERIOD_STATS(fromD, toD)},
    o AS (
      SELECT o.supplier_id, SUM(COALESCE(os.amount,0)) AS amount, SUM(COALESCE(pd.delivered,0)) AS delivered, SUM(COALESCE(pp.paid,0)) AS paid
      FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN per_deliv pd ON pd.order_id = o.id LEFT JOIN per_paid pp ON pp.order_id = o.id
      WHERE o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND ${orderScope(u)} AND o.order_date BETWEEN ${fromD}::date AND ${toD}::date GROUP BY o.supplier_id),
    a AS (SELECT p.supplier_id, SUM(p.amount) AS adv FROM payments p WHERE p.order_id IS NULL AND p.deleted_at IS NULL AND ${adv}
      AND COALESCE(p.date, p.created_at::date) BETWEEN ${fromD}::date AND ${toD}::date GROUP BY p.supplier_id)
    SELECT s.id, s.name, COALESCE(o.amount,0) amount, COALESCE(o.delivered,0) delivered, COALESCE(o.paid,0) paid, COALESCE(a.adv,0) adv
    FROM suppliers s LEFT JOIN o ON o.supplier_id = s.id LEFT JOIN a ON a.supplier_id = s.id
    WHERE o.supplier_id IS NOT NULL OR a.supplier_id IS NOT NULL
    ORDER BY COALESCE(o.delivered,0) - COALESCE(o.paid,0) - COALESCE(a.adv,0) DESC`);
  const rows = (res.rows as { id: string; name: string; amount: string; delivered: string; paid: string; adv: string }[]).map((r) => ({
    ...r,
    paidAll: Number(r.paid) + Number(r.adv),
    debtOrder: Number(r.amount) - Number(r.paid) - Number(r.adv),
    debtShip: Number(r.delivered) - Number(r.paid) - Number(r.adv),
  }));
  const t = rows.reduce((a, r) => ({ amount: a.amount + Number(r.amount), delivered: a.delivered + Number(r.delivered), paid: a.paid + r.paidAll, debtShip: a.debtShip + Math.max(r.debtShip, 0), prepaid: a.prepaid + Math.max(-r.debtShip, 0) }), { amount: 0, delivered: 0, paid: 0, debtShip: 0, prepaid: 0 });
  // по каким заказам набежал долг по отгрузке: поставлено − оплачено по каждому заказу
  const ordRes = await db.execute(sql`
    WITH ${PERIOD_STATS(fromD, toD)}
    SELECT o.id, o.number, o.supplier_id, COALESCE(o.invoice_date, o.order_date) AS dt, o.invoice_number,
      COALESCE(pd.delivered,0) AS delivered, COALESCE(pp.paid,0) AS paid
    FROM purchase_orders o LEFT JOIN per_deliv pd ON pd.order_id = o.id LEFT JOIN per_paid pp ON pp.order_id = o.id
    WHERE o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND ${orderScope(u)} AND o.order_date BETWEEN ${fromD}::date AND ${toD}::date
      AND abs(COALESCE(pd.delivered,0) - COALESCE(pp.paid,0)) > 0.5
    ORDER BY COALESCE(o.invoice_date, o.order_date), o.number`);
  const bySup = new Map<string, DebtOrder[]>();
  for (const r of ordRes.rows as { id: string; number: number; supplier_id: string; dt: string | null; invoice_number: string | null; delivered: string; paid: string }[]) {
    const list = bySup.get(r.supplier_id) ?? [];
    list.push({ id: r.id, number: r.number, dt: r.dt, invoice_number: r.invoice_number, delivered: Number(r.delivered), paid: Number(r.paid), diff: Number(r.delivered) - Number(r.paid) });
    bySup.set(r.supplier_id, list);
  }
  const shown = only === "debt" ? rows.filter((r) => r.debtShip > 0.5) : only === "prepaid" ? rows.filter((r) => r.debtShip < -0.5).sort((a, b) => a.debtShip - b.debtShip) : rows;
  const shownSum = shown.reduce((s, r) => s + r.debtShip, 0);
  const cols = 7;
  return (
    <>
      <FilterBar base="/payments" sp={sp} keep={["only"]}>
        <FDate name="from" sp={sp} label="Заказы с" />
        <FDate name="to" sp={sp} label="по" />
        {(from || to) && (
          <span className="self-center text-xs text-slate-500">
            заказы {from ? `с ${fmtDate(from)} ` : ""}{to ? `по ${fmtDate(to)}` : "по сегодня"}; поставки и оплаты — {to ? `по ${fmtDate(to)} включительно` : "все"}
          </span>
        )}
      </FilterBar>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Сумма заказов" value={fmtMoney(t.amount)} href={`/orders?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`} />
        <Stat label="Поставлено на сумму" value={fmtMoney(t.delivered)} href="/deliveries?tab=log" />
        <Stat label="Оплачено" value={fmtMoney(t.paid)} sub={t.amount ? `${Math.round((t.paid / t.amount) * 100)}% от заказов` : undefined} href="/payments?tab=log" />
        <Stat label="Мы должны (по отгрузке)" value={fmtMoney(t.debtShip)} tone={t.debtShip > 0 ? "amber" : undefined} sub="кому и по каким заказам →" href={only === "debt" ? keepQs() : keepQs({ only: "debt" })} />
        <Stat label="Авансы у поставщиков" value={fmtMoney(t.prepaid)} sub="оплачено, но ещё не поставлено" href={only === "prepaid" ? keepQs() : keepQs({ only: "prepaid" })} />
      </div>
      {only && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {only === "debt" ? "Показаны только долги по отгрузке" : "Показаны только авансы у поставщиков"}: {shown.length} {plural(shown.length, "поставщик", "поставщика", "поставщиков")} на {fmtMoney(Math.abs(shownSum))}. Нажмите на поставщика — раскроются заказы.
          </span>
          <Link href={keepQs()} className="ml-auto font-medium text-brand-700 hover:underline">показать всех</Link>
        </div>
      )}
      <Card pad={false}>
        <Table>
          <thead>
            <tr><Th>Поставщик</Th><Th right>Сумма заказов</Th><Th right>Поставлено</Th><Th right>Оплачено</Th><Th right>% оплаты</Th><Th right>Долг по заказам</Th><Th right>Долг по отгрузке</Th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={cols} className="px-3 py-6 text-center text-sm text-slate-500">{only === "debt" ? "Долгов по отгрузке нет" : "Авансов у поставщиков нет"}</td></tr>
            )}
            {shown.map((r) => {
              const cells = [
                <Fragment key="name">
                  <Link href={`/suppliers/${r.id}?tab=payments`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link>
                  {Number(r.adv) > 0 && <div className="ml-5 text-xs text-slate-500">в т.ч. авансы без счёта {fmtMoney(r.adv)}</div>}
                </Fragment>,
                fmtMoney(r.amount),
                fmtMoney(r.delivered),
                fmtMoney(r.paidAll),
                Number(r.amount) ? `${Math.round((r.paidAll / Number(r.amount)) * 100)}%` : "—",
                fmtMoney(r.debtOrder),
                <span key="debt" className={r.debtShip > 0.5 ? "font-medium text-amber-700" : r.debtShip < -0.5 ? "text-emerald-700" : ""}>{fmtMoney(r.debtShip)}</span>,
              ];
              const ords = bySup.get(r.id) ?? [];
              if (!ords.length && !(Number(r.adv) > 0))
                return (
                  <tr key={r.id}>
                    {cells.map((c, i) => (
                      <Td key={i} right={i > 0}>{i === 0 ? <span className="ml-[18px] inline-block">{c}</span> : c}</Td>
                    ))}
                  </tr>
                );
              return <ExpandableRow key={r.id} cols={cols} cells={cells} detail={<DebtBreakdown supplierId={r.id} orders={ords} adv={Number(r.adv)} total={r.debtShip} />} />;
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-2 text-xs text-slate-500">
        Долг по заказам = сумма заказов − оплаты (сколько ещё заплатить по счетам). Долг по отгрузке = сумма фактически поставленного − оплаты (положительный — мы должны за полученный товар, отрицательный — аванс у поставщика). Нажмите на поставщика, чтобы увидеть, по каким заказам этот долг.
      </p>
    </>
  );
}

/** Поставлено и оплачено по каждому заказу на дату «по» (для задолженностей за период) */
const PERIOD_STATS = (from: string, to: string) => sql`
  per_deliv AS (
    SELECT d.order_id, SUM(di.qty * COALESCE(di.price, poi.price)) AS delivered
    FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id LEFT JOIN purchase_order_items poi ON poi.id = di.order_item_id
    WHERE d.deleted_at IS NULL AND d.date <= ${to}::date GROUP BY d.order_id),
  per_paid AS (
    SELECT p.order_id, SUM(p.amount) AS paid FROM payments p
    WHERE p.order_id IS NOT NULL AND p.deleted_at IS NULL AND COALESCE(p.date, p.created_at::date) <= ${to}::date GROUP BY p.order_id)`;

type DebtOrder = { id: string; number: number; dt: string | null; invoice_number: string | null; delivered: number; paid: number; diff: number };

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

/** Долг поставщика по отгрузке по заказам: сначала где мы должны, потом переплаты; авансы без счёта вычитаются */
function DebtBreakdown({ supplierId, orders, adv, total }: { supplierId: string; orders: DebtOrder[]; adv: number; total: number }) {
  const owe = orders.filter((o) => o.diff > 0);
  const over = orders.filter((o) => o.diff < 0);
  const row = (o: DebtOrder) => (
    <tr key={o.id} className="border-b border-slate-200">
      <td className="py-1 pr-3">
        <Link href={`/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">{orderNo(o.number)}</Link>
        {o.invoice_number && <span className="ml-1 text-slate-500">счёт {o.invoice_number}</span>}
      </td>
      <td className="py-1 pr-3 text-slate-500">{fmtDate(o.dt)}</td>
      <td className="py-1 pr-3 text-right">{fmtMoney(o.delivered)}</td>
      <td className="py-1 pr-3 text-right">{fmtMoney(o.paid)}</td>
      <td className={`py-1 text-right font-medium ${o.diff > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmtMoney(o.diff)}</td>
    </tr>
  );
  return (
    <>
    <table className="w-full max-w-3xl text-xs tabular-nums">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="py-1 pr-3 font-medium">Заказ</th>
          <th className="py-1 pr-3 font-medium">Дата счёта</th>
          <th className="py-1 pr-3 text-right font-medium">Поставлено</th>
          <th className="py-1 pr-3 text-right font-medium">Оплачено</th>
          <th className="py-1 text-right font-medium">Долг</th>
        </tr>
      </thead>
      <tbody>
        {owe.map(row)}
        {over.length > 0 && (
          <tr>
            <td colSpan={5} className="pt-2 text-slate-500">Оплачено больше, чем поставлено (аванс по заказу):</td>
          </tr>
        )}
        {over.map(row)}
        {adv > 0 && (
          <tr className="border-b border-slate-200">
            <td colSpan={4} className="py-1 text-slate-600">Авансы без счёта</td>
            <td className="py-1 text-right font-medium text-emerald-700">{fmtMoney(-adv)}</td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td colSpan={4} className="pt-1.5">{total >= 0 ? "Итого мы должны" : "Итого аванс у поставщика"}</td>
          <td className="pt-1.5 text-right">{fmtMoney(Math.abs(total))}</td>
        </tr>
      </tfoot>
    </table>
    <Link href={`/suppliers/${supplierId}/act`} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Акт сверки с поставщиком →</Link>
    </>
  );
}

async function Log({ u, sp, opts }: { u: U; sp: SP; opts: Awaited<ReturnType<typeof selectOptions>> }) {
  const { page, limit, offset } = pageParams(sp);
  const adv = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
  const w = [sql`p.deleted_at IS NULL`, sql`((p.order_id IS NOT NULL AND o.deleted_at IS NULL AND ${orderScope(u)}) OR (p.order_id IS NULL AND ${adv}))`];
  const sup = qp(sp, "supplier");
  if (sup) w.push(sql`p.supplier_id = ${sup}`);
  const type = qp(sp, "type");
  if (type === "noorder") w.push(sql`p.order_id IS NULL`);
  else if (type) w.push(sql`p.type = ${type}`);
  const from = qp(sp, "from");
  if (from) w.push(sql`p.date >= ${from}::date`);
  const to = qp(sp, "to");
  if (to) w.push(sql`p.date <= ${to}::date`);
  const q = qp(sp, "q");
  if (q) w.push(sql`(s.name ILIKE ${"%" + q + "%"} OR p.doc_number ILIKE ${"%" + q + "%"} OR p.comment ILIKE ${"%" + q + "%"} OR o.invoice_number ILIKE ${"%" + q + "%"})`);
  const res = await db.execute(sql`
    SELECT p.*, s.name AS supplier, o.number, COALESCE(le.short_name, le.name) AS legal, COUNT(*) OVER()::int AS total, SUM(p.amount) OVER() AS sum_all
    FROM payments p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN purchase_orders o ON o.id = p.order_id LEFT JOIN legal_entities le ON le.id = p.legal_entity_id
    WHERE ${sql.join(w, sql` AND `)} ORDER BY p.date DESC NULLS FIRST, p.created_at DESC LIMIT ${limit} OFFSET ${offset}`);
  const rows = res.rows as { id: string; date: string | null; amount: string; type: string; method: string; doc_number: string | null; comment: string | null; order_id: string | null; number: number | null; supplier: string; supplier_id: string; legal: string | null; total: number; sum_all: string }[];
  return (
    <>
      <FilterBar base="/payments" sp={sp} keep={["tab"]}>
        <SearchInput sp={sp} placeholder="Поставщик, № ПП, счёт" />
        <FSelect searchable name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        <FSelect name="type" sp={sp} placeholder="Все типы" options={[...Object.entries(PAYMENT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })), { value: "noorder", label: "Без привязки к заказу" }]} />
        <FDate name="from" sp={sp} label="с" />
        <FDate name="to" sp={sp} label="по" />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <Empty>Платежей нет</Empty> : (
          <Table>
            <thead><tr><Th>Дата</Th><Th>Поставщик</Th><Th>Заказ</Th><Th>Тип</Th><Th right>Сумма</Th><Th>№ ПП</Th><Th>Плательщик</Th><Th>Комментарий</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{p.date ? fmtDate(p.date) : <Badge tone="amber">без даты</Badge>}</Td>
                  <Td className="max-w-48 truncate"><Link href={`/suppliers/${p.supplier_id}?tab=payments`} className="hover:text-brand-700">{p.supplier}</Link></Td>
                  <Td>{p.order_id ? <Link className="text-brand-700 hover:underline" href={`/orders/${p.order_id}`}>{orderNo(p.number!)}</Link> : <Badge tone="violet">без счёта</Badge>}</Td>
                  <Td>{PAYMENT_TYPE_LABEL[p.type]}{p.method === "CASH" && ` · ${PAYMENT_METHOD_LABEL.CASH}`}</Td>
                  <Td right>{fmtMoney(p.amount, 2)}</Td>
                  <Td>{p.doc_number ?? "—"}</Td>
                  <Td className="text-xs">{p.legal ?? "—"}</Td>
                  <Td className="max-w-72 text-xs text-slate-500">{p.comment}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-3 pt-2 text-sm text-slate-600">
          <span>Сумма по фильтру: <b>{fmtMoney(rows[0]?.sum_all ?? 0, 2)}</b></span>
        </div>
        <Pagination base="/payments" sp={sp} total={rows[0]?.total ?? 0} page={page} size={limit} />
      </Card>
    </>
  );
}
