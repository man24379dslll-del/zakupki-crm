import Link from "next/link";
import { sql } from "drizzle-orm";
import { requirePagePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { listOrders } from "@/lib/services/orders";
import { fmtDate, fmtMoney, orderNo } from "@/lib/format";
import { Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterBar, SearchInput, qp, type SP } from "@/components/list";

export const metadata = { title: "Новая оплата" };

/** Шаг 1 — выбор заказа с неоплаченным остатком. Оплата вносится на странице заказа (или аванс — в карточке поставщика). */
export default async function NewPayment({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requirePagePerm(PERMS.ordersEdit);
  const q = qp(sp, "q");
  const rows = await listOrders(u, {
    where: [sql`o.status <> 'CANCELLED'`, sql`COALESCE(os.amount,0) - COALESCE(ps.paid,0) > 0.009`, ...(q ? [sql`(s.name ILIKE ${"%" + q + "%"} OR o.invoice_number ILIKE ${"%" + q + "%"} OR o.number::text = ${q.replace(/\D/g, "") || "-"})`] : [])],
    limit: 200,
  });
  return (
    <>
      <PageHeader title="Новая оплата" subtitle="Выберите заказ, по которому прошёл платёж. Аванс без счёта вносится в карточке поставщика → «Оплаты и долги»." back={{ href: "/payments", label: "Оплаты" }} />
      <FilterBar base="/payments/new" sp={sp}>
        <SearchInput sp={sp} placeholder="Поставщик, № счёта или заказа" />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <Empty>Неоплаченных заказов нет</Empty> : (
          <Table>
            <thead><tr><Th>Заказ</Th><Th>Поставщик</Th><Th>Счёт</Th><Th right>Сумма</Th><Th right>Оплачено</Th><Th right>Осталось оплатить</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{orderNo(r.number)} <span className="text-xs text-slate-500">{fmtDate(r.order_date)}</span></Td>
                  <Td>{r.supplier_name}</Td>
                  <Td>{r.invoice_number ?? "—"}</Td>
                  <Td right>{fmtMoney(r.amount)}</Td>
                  <Td right>{fmtMoney(r.paid)}</Td>
                  <Td right className="font-medium">{fmtMoney(Number(r.amount) - Number(r.paid))}</Td>
                  <Td><Link href={`/orders/${r.id}#payments`} className="text-xs font-medium text-brand-700 hover:underline">Внести →</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
