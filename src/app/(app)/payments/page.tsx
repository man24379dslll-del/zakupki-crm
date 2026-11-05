import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { orderScope, ORDER_STATS } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtMoney, orderNo, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { ExportLink, FDate, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, type SP } from "@/components/list";

export const metadata = { title: "Оплаты" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const tab = qp(sp, "tab") || "debts";
  const opts = await selectOptions();
  return (
    <>
      <PageHeader
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
      {tab === "debts" ? <Debts u={u} /> : <Log u={u} sp={sp} opts={opts} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;

async function Debts({ u }: { u: U }) {
  const adv = can(u, PERMS.ordersViewAll) ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = p.supplier_id AND sb.user_id = ${u.id})`;
  const res = await db.execute(sql`
    WITH ${ORDER_STATS},
    o AS (
      SELECT o.supplier_id, SUM(COALESCE(os.amount,0)) AS amount, SUM(COALESCE(os.delivered_amount,0)) AS delivered, SUM(COALESCE(ps.paid,0)) AS paid
      FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN pay_stats ps ON ps.order_id = o.id
      WHERE o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND ${orderScope(u)} GROUP BY o.supplier_id),
    a AS (SELECT p.supplier_id, SUM(p.amount) AS adv FROM payments p WHERE p.order_id IS NULL AND p.deleted_at IS NULL AND ${adv} GROUP BY p.supplier_id)
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
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Сумма заказов" value={fmtMoney(t.amount)} />
        <Stat label="Поставлено на сумму" value={fmtMoney(t.delivered)} />
        <Stat label="Оплачено" value={fmtMoney(t.paid)} sub={t.amount ? `${Math.round((t.paid / t.amount) * 100)}% от заказов` : undefined} />
        <Stat label="Мы должны (по отгрузке)" value={fmtMoney(t.debtShip)} tone={t.debtShip > 0 ? "amber" : undefined} />
        <Stat label="Авансы у поставщиков" value={fmtMoney(t.prepaid)} sub="оплачено, но ещё не поставлено" />
      </div>
      <Card pad={false}>
        <Table>
          <thead>
            <tr><Th>Поставщик</Th><Th right>Сумма заказов</Th><Th right>Поставлено</Th><Th right>Оплачено</Th><Th right>% оплаты</Th><Th right>Долг по заказам</Th><Th right>Долг по отгрузке</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/suppliers/${r.id}?tab=payments`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link>{Number(r.adv) > 0 && <div className="text-xs text-slate-500">в т.ч. авансы без счёта {fmtMoney(r.adv)}</div>}</Td>
                <Td right>{fmtMoney(r.amount)}</Td>
                <Td right>{fmtMoney(r.delivered)}</Td>
                <Td right>{fmtMoney(r.paidAll)}</Td>
                <Td right>{Number(r.amount) ? `${Math.round((r.paidAll / Number(r.amount)) * 100)}%` : "—"}</Td>
                <Td right>{fmtMoney(r.debtOrder)}</Td>
                <Td right className={r.debtShip > 0.5 ? "font-medium text-amber-700" : r.debtShip < -0.5 ? "text-emerald-700" : ""}>{fmtMoney(r.debtShip)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-2 text-xs text-slate-500">
        Долг по заказам = сумма заказов − оплаты (сколько ещё заплатить по счетам). Долг по отгрузке = сумма фактически поставленного − оплаты (положительный — мы должны за полученный товар, отрицательный — аванс у поставщика).
      </p>
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
