import Link from "next/link";
import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { supplierList } from "@/lib/services/suppliers";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, fmtDate, fmtMoney, SUPPLIER_STATUS_LABEL, SUPPLIER_STATUS_TONE, today } from "@/lib/format";
import { CONTRACT_TONE, CONTRACT_WARN_DAYS, contractState } from "@/lib/services/contracts";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { ExportLink, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, SortTh, type SP } from "@/components/list";

export const metadata = { title: "Поставщики" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const { page, limit, offset } = pageParams(sp);
  const w = [];
  const q = qp(sp, "q");
  if (q) w.push(sql`(s.name ILIKE ${"%" + q + "%"} OR s.inn ILIKE ${"%" + q + "%"} OR s.contact_person ILIKE ${"%" + q + "%"} OR s.legal_name ILIKE ${"%" + q + "%"})`);
  const st = qp(sp, "status");
  if (st) w.push(sql`s.status = ${st}`);
  const buyer = qp(sp, "buyer");
  if (buyer === "me") w.push(sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = s.id AND sb.user_id = ${u.id})`);
  else if (buyer === "none") w.push(sql`NOT EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = s.id)`);
  else if (buyer) w.push(sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = s.id AND sb.user_id = ${buyer})`);
  const ct = qp(sp, "contract");
  const soon = addDays(today(), CONTRACT_WARN_DAYS);
  if (ct === "none") w.push(sql`ct.id IS NULL`);
  else if (ct === "expiring") w.push(sql`ct.valid_until BETWEEN ${today()}::date AND ${soon}::date`);
  else if (ct === "expired") w.push(sql`ct.valid_until < ${today()}::date`);
  else if (ct === "problem") w.push(sql`(ct.id IS NULL OR ct.valid_until <= ${soon}::date)`);
  const dir = qp(sp, "dir") === "asc" ? sql`ASC` : sql`DESC`;
  const order =
    qp(sp, "sort") === "amount" ? sql`COALESCE(o.amount,0) ${dir}` : qp(sp, "sort") === "debt" ? sql`COALESCE(o.delivered_amount,0) - COALESCE(o.paid_orders,0) - COALESCE(adv.advances,0) ${dir}` : qp(sp, "sort") === "last" ? sql`o.last_order ${dir} NULLS LAST` : sql`s.name ASC`;
  const [rows, opts] = await Promise.all([supplierList(u, w, order, limit, offset), selectOptions()]);
  const base = "/suppliers";
  const d = today();
  return (
    <>
      <PageHeader help={"suppliers"}
        title="Поставщики"
        actions={
          <>
            <ExportLink entity="suppliers" sp={sp} />
            {can(u, PERMS.suppliersEdit) && (
              <LinkButton href="/suppliers/new" variant="primary">
                + Поставщик
              </LinkButton>
            )}
          </>
        }
      />
      <FilterBar base={base} sp={sp}>
        <SearchInput sp={sp} placeholder="Название, ИНН, контакт" />
        <FSelect name="status" sp={sp} placeholder="Все статусы" options={Object.entries(SUPPLIER_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        <FSelect searchable name="buyer" sp={sp} placeholder="Все ответственные" options={[{ value: "me", label: "Мои" }, ...(can(u, PERMS.ordersViewAll) ? [{ value: "none", label: "Без ответственного" }, ...opt(opts.buyers)] : [])]} />
        <FSelect name="contract" sp={sp} placeholder="Договор: любой" options={[{ value: "problem", label: "Нет или истекает/истёк" }, { value: "none", label: "Без договора" }, { value: "expiring", label: `Истекает в ${CONTRACT_WARN_DAYS} дней` }, { value: "expired", label: "Истёк" }]} />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>Поставщиков не найдено</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Поставщик</Th>
                <Th>Статус</Th>
                <Th>Договор</Th>
                <Th>Ответственные</Th>
                <Th right>Заказов</Th>
                <SortTh label="Объём закупок" field="amount" base={base} sp={sp} right />
                <SortTh label="Долг по отгрузке" field="debt" base={base} sp={sp} right />
                <SortTh label="Последний заказ" field="last" base={base} sp={sp} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const debt = Number(r.delivered_amount) - Number(r.paid_orders) - Number(r.advances);
                return (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/suppliers/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {r.name}
                      </Link>
                      {r.activity && <div className="text-xs text-slate-500">{r.activity}</div>}
                    </Td>
                    <Td>
                      <Badge tone={SUPPLIER_STATUS_TONE[r.status]}>{SUPPLIER_STATUS_LABEL[r.status]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {(() => {
                        const st = contractState(r.contract_id ? { valid_until: r.contract_until } : null, d);
                        return <Badge tone={CONTRACT_TONE[st]}>{st === "none" ? "нет" : st === "expired" ? "истёк" : r.contract_until ? `до ${fmtDate(r.contract_until)}` : "бессрочный"}</Badge>;
                      })()}
                    </Td>
                    <Td className="text-xs">{r.buyers ?? <span className="text-slate-400">—</span>}</Td>
                    <Td right>
                      {r.orders}
                      {r.active_orders > 0 && <span className="text-xs text-slate-500"> ({r.active_orders} акт.)</span>}
                    </Td>
                    <Td right>{fmtMoney(r.amount)}</Td>
                    <Td right className={debt > 0 ? "text-amber-700" : debt < 0 ? "text-emerald-700" : ""}>
                      {fmtMoney(debt)}
                    </Td>
                    <Td>{fmtDate(r.last_order)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base={base} sp={sp} total={rows[0]?.total ?? 0} page={page} size={limit} />
      </Card>
      <p className="mt-2 text-xs text-slate-500">Долг по отгрузке = сумма поставленного − оплаты по заказам − авансы без счёта. Отрицательное значение — аванс у поставщика.</p>
    </>
  );
}
