import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { listOrders } from "@/lib/services/orders";
import { orderFilters } from "@/lib/services/order-filters";
import { fmtDate, fmtMoney, ORDER_STATUS_LABEL, orderNo } from "@/lib/format";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Поиск" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser();
  const q = ((await searchParams).q ?? "").trim();
  if (!q) return <PageHeader title="Поиск" subtitle="Введите запрос в строке поиска" />;
  const like = `%${q}%`;
  const [orders, sup, prod] = await Promise.all([
    listOrders(u, { where: orderFilters({ q }), limit: 20 }),
    db.execute(sql`SELECT id, name, inn FROM suppliers WHERE deleted_at IS NULL AND (name ILIKE ${like} OR inn ILIKE ${like} OR legal_name ILIKE ${like}) ORDER BY name LIMIT 20`),
    db.execute(sql`SELECT id, name FROM products WHERE merged_into_id IS NULL AND (name ILIKE ${like} OR sku ILIKE ${like}) ORDER BY name LIMIT 20`),
  ]);
  const s = sup.rows as { id: string; name: string; inn: string | null }[];
  const p = prod.rows as { id: string; name: string }[];
  return (
    <>
      <PageHeader title={`Поиск: «${q}»`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={`Заказы (${orders.length})`} pad={false}>
          {orders.length === 0 ? <Empty>Нет</Empty> : <ul className="divide-y divide-slate-100">{orders.map((o) => <li key={o.id} className="px-4 py-2 text-sm"><Link href={`/orders/${o.id}`} className="font-medium text-brand-700">{orderNo(o.number)}</Link> · {o.supplier_name}<div className="text-xs text-slate-500">{fmtDate(o.order_date)} · {fmtMoney(o.amount)} · {ORDER_STATUS_LABEL[o.status]}</div></li>)}</ul>}
        </Card>
        <Card title={`Поставщики (${s.length})`} pad={false}>
          {s.length === 0 ? <Empty>Нет</Empty> : <ul className="divide-y divide-slate-100">{s.map((x) => <li key={x.id} className="px-4 py-2 text-sm"><Link href={`/suppliers/${x.id}`} className="hover:text-brand-700">{x.name}</Link>{x.inn && <span className="text-xs text-slate-500"> · ИНН {x.inn}</span>}</li>)}</ul>}
        </Card>
        <Card title={`Товары (${p.length})`} pad={false}>
          {p.length === 0 ? <Empty>Нет</Empty> : <ul className="divide-y divide-slate-100">{p.map((x) => <li key={x.id} className="px-4 py-2 text-sm"><Link href={`/products/${x.id}`} className="hover:text-brand-700">{x.name}</Link></li>)}</ul>}
        </Card>
      </div>
    </>
  );
}
