import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { listOrders } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { orderFilters, orderSort } from "@/lib/services/order-filters";
import { fmtDate, fmtMoney, fmtQty, ORDER_PAY_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, orderNo } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, Progress, Table, Td, Th } from "@/components/ui";
import { ExportLink, FDate, FilterBar, FSelect, pageParams, Pagination, qp, SavedViews, SearchInput, SortTh, type SP } from "@/components/list";
import { SaveViewButton } from "@/components/client";
import { saveViewAction } from "@/app/actions/common";

export const metadata = { title: "Заказы" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const { page, limit, offset } = pageParams(sp);
  const [rows, opts, views] = await Promise.all([
    listOrders(u, { where: orderFilters(sp), orderBy: orderSort(sp), limit, offset }),
    selectOptions({ inactive: true }),
    db.select().from(schema.savedViews).where(and(eq(schema.savedViews.userId, u.id), eq(schema.savedViews.page, "/orders"))),
  ]);
  const total = rows[0]?.total_count ?? 0;
  const base = "/orders";
  const all = can(u, PERMS.ordersViewAll);

  return (
    <>
      <PageHeader
        title="Заказы"
        subtitle={all ? "Все заказы отдела" : "Ваши заказы"}
        actions={
          <>
            <ExportLink entity="orders" sp={sp} />
            {can(u, PERMS.ordersEdit) && (
              <LinkButton href="/orders/new" variant="primary">
                + Новый заказ
              </LinkButton>
            )}
          </>
        }
      />
      <SavedViews views={views} base={base} />
      <FilterBar base={base} sp={sp}>
        <SearchInput sp={sp} placeholder="№ заказа, счёт, товар, поставщик" />
        <FSelect name="status" sp={sp} placeholder="Все статусы" options={[{ value: "active", label: "Активные" }, { value: "expected", label: "Ждём поставку (недопоставка)" }, { value: "overdue", label: "Просроченные" }, ...Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
        <FSelect searchable name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        {qp(sp, "product") && <FSelect searchable name="product" sp={sp} placeholder="Все товары" options={opt(opts.products)} />}
        {all && <FSelect searchable name="buyer" sp={sp} placeholder="Все закупщики" options={[{ value: "none", label: "Не назначен" }, ...opt(opts.buyers)]} />}
        <FSelect searchable name="legal" sp={sp} placeholder="Все юрлица" options={opt(opts.legal)} />
        <FSelect searchable name="direction" sp={sp} placeholder="Все направления" options={opt(opts.directions)} />
        <FSelect name="pay" sp={sp} placeholder="Любой способ оплаты" options={[...Object.entries(ORDER_PAY_LABEL).map(([v, l]) => ({ value: v, label: l })), { value: "none", label: "Способ не указан" }]} />
        <FDate name="from" sp={sp} label="с" />
        <FDate name="to" sp={sp} label="по" />
      </FilterBar>
      <div className="mb-2 flex justify-end">
        <SaveViewButton action={saveViewAction} page={base} />
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>Заказов не найдено</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <SortTh label="№" field="number" base={base} sp={sp} />
                <SortTh label="Дата" field="date" base={base} sp={sp} def />
                <SortTh label="Поставщик" field="supplier" base={base} sp={sp} />
                <Th>Счёт</Th>
                <Th>Товары</Th>
                {all && <Th>Закупщик</Th>}
                <SortTh label="Сумма" field="amount" base={base} sp={sp} right />
                <SortTh label="Поставлено" field="delivered" base={base} sp={sp} />
                <SortTh label={qp(sp, "sort") === "debt_ship" ? "Долг по отгрузке" : "Долг по заказу"} field={qp(sp, "sort") === "debt_ship" ? "debt_ship" : "debt"} base={base} sp={sp} right />
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = Number(r.qty) > 0 ? (Number(r.delivered) / Number(r.qty)) * 100 : 0;
                // «Долг по отгрузке» из аналитики: поставлено − оплачено, иначе долг по заказу
                const debt = qp(sp, "sort") === "debt_ship" ? Number(r.delivered_amount) - Number(r.paid) : Number(r.amount) - Number(r.paid);
                return (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/orders/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {orderNo(r.number)}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.order_date)}</Td>
                    <Td className="max-w-48 truncate">{r.supplier_name}</Td>
                    <Td>{r.invoice_number ?? "—"}</Td>
                    <Td className="max-w-64">
                      <div className="truncate text-xs text-slate-500" title={r.products ?? ""}>
                        {r.products}
                      </div>
                    </Td>
                    {all && <Td className="whitespace-nowrap text-xs">{r.buyer_name ?? <span className="text-slate-400">не назначен</span>}</Td>}
                    <Td right>{fmtMoney(r.amount)}</Td>
                    <Td className="min-w-32">
                      <div className="mb-1 text-xs tabular-nums text-slate-500">
                        {fmtQty(r.delivered)} / {fmtQty(r.qty)}
                      </div>
                      <Progress value={pct} tone={pct >= 100 ? "green" : r.overdue ? "red" : "brand"} />
                      {qp(sp, "sort") === "delivered" && <div className="mt-1 text-xs tabular-nums text-slate-500">{fmtMoney(r.delivered_amount)}</div>}
                    </Td>
                    <Td right className={debt > 0 ? "text-slate-900" : "text-emerald-700"}>
                      {fmtMoney(debt)}
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Badge>
                        {r.overdue && <Badge tone="red">просрочен</Badge>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base={base} sp={sp} total={total} page={page} size={limit} />
      </Card>
    </>
  );
}

void sql;
