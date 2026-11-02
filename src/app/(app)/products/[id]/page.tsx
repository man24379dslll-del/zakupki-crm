import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { compareSuppliers, getWindowMode, monthlySeries, pricePoints, priceWindow, productPriceCard } from "@/lib/services/prices";
import { listOrders } from "@/lib/services/orders";
import { fmtDate, fmtMoney, fmtPct, fmtPrice, fmtQty, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, orderNo, today } from "@/lib/format";
import { Badge, Card, Empty, Field, Input, PageHeader, Stat, Table, Tabs, Td, Textarea, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { HistoryBlock } from "@/components/blocks";
import { PriceChart } from "@/components/charts";
import { updateProductAction } from "../actions";

export const metadata = { title: "Товар" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; period?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "prices";
  const period = sp.period === "12" ? 12 : 6;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!p) notFound();
  if (p.mergedIntoId) redirect(`/products/${p.mergedIntoId}`);
  const card = await productPriceCard(id, 6);
  const mode = await getWindowMode();
  const w = priceWindow(6, mode);
  const all = await pricePoints([id]);
  const win = all.filter((x) => x.date >= w.from && x.date <= w.to);
  const cmp = compareSuppliers(win);
  const base = `/products/${id}`;

  // график: общая средняя и по каждому поставщику помесячно
  const chartFrom = monthlySeries(all, period, today());
  const supIds = [...new Set(all.map((x) => x.supplierId))].slice(0, 5);
  const series = [{ key: "avg", name: "Все поставщики" }, ...(supIds.length > 1 ? supIds.map((s) => ({ key: s, name: all.find((x) => x.supplierId === s)!.supplierName })) : [])];
  const data = chartFrom.map((m) => {
    const row: Record<string, string | number | null> = { month: m.month, avg: m.avg };
    if (supIds.length > 1) for (const s of supIds) row[s] = monthlySeries(all.filter((x) => x.supplierId === s), period, today()).find((x) => x.month === m.month)?.avg ?? null;
    return row;
  });
  const plan = await db.select({ e: schema.supplyPlanEntries, s: schema.suppliers.name }).from(schema.supplyPlanEntries).innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplyPlanEntries.supplierId)).where(eq(schema.supplyPlanEntries.productId, id)).orderBy(asc(schema.supplyPlanEntries.weekStart));

  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Товары" }}
        title={p.name}
        subtitle={[p.sku && `арт. ${p.sku}`, p.category, `ед. изм.: ${p.unit}`, !p.isActive && "неактивен"].filter(Boolean).join(" · ")}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Stat label="Последняя цена" value={fmtPrice(card.lastPrice)} sub={card.lastDate ? fmtDate(card.lastDate) : "Нет данных"} />
        <Stat label="Средневзвешенная, 6 мес." value={card.avg === null ? "Нет данных" : fmtPrice(card.avg)} sub={`${fmtDate(w.from)} — ${fmtDate(w.to)}`} />
        <Stat label="Минимум, 6 мес." value={fmtPrice(card.min)} />
        <Stat label="Максимум, 6 мес." value={fmtPrice(card.max)} />
        <Stat label="Изменение к пред. закупке" value={card.change === null ? "—" : `${card.change > 0 ? "+" : ""}${card.change.toFixed(1)}%`} sub={card.prevPrice !== null ? `было ${fmtPrice(card.prevPrice)}` : undefined} tone={card.change !== null && card.change > 0 ? "amber" : undefined} />
        <Stat label="Закуплено всего" value={`${fmtQty(card.totalQty)} ${p.unit}`} sub={`за 6 мес.: ${fmtQty(card.qty)}`} />
        <Stat label="Сумма закупок всего" value={fmtMoney(card.totalAmount)} sub={`за 6 мес.: ${fmtMoney(card.amount)}`} />
      </div>
      <Tabs base={base} current={tab} tabs={[{ key: "prices", label: "Цены и поставщики" }, { key: "deliveries", label: "История поставок", count: all.length }, { key: "orders", label: "Заказы" }, { key: "plan", label: "План", count: plan.length }, { key: "edit", label: "Карточка" }, { key: "history", label: "Изменения" }]} />
      {tab === "prices" && (
        <div className="space-y-4">
          <Card title="Сравнение поставщиков за 6 месяцев" pad={false}>
            {cmp.length === 0 ? <Empty>Нет поставок с ценой за период</Empty> : (
              <Table>
                <thead><tr><Th>Поставщик</Th><Th right>Средневзв. цена</Th><Th right>Разница с лучшей</Th><Th right>Поставлено</Th><Th right>Сумма</Th><Th right>Поставок</Th><Th right>Последняя цена</Th></tr></thead>
                <tbody>
                  {cmp.map((r, i) => (
                    <tr key={r.supplierId}>
                      <Td><Link className="hover:text-brand-700" href={`/suppliers/${r.supplierId}?tab=prices`}>{r.supplierName}</Link>{i === 0 && cmp.length > 1 && <Badge tone="green">дешевле всех</Badge>}</Td>
                      <Td right className="font-medium">{fmtPrice(r.avg)}</Td>
                      <Td right>{i === 0 ? "—" : r.diffFromBest === null ? "—" : `+${r.diffFromBest.toFixed(1)}%`}</Td>
                      <Td right>{fmtQty(r.qty)} {p.unit}</Td>
                      <Td right>{fmtMoney(r.amount)}</Td>
                      <Td right>{r.deliveries}</Td>
                      <Td right>{fmtPrice(r.lastPrice)}<div className="text-xs text-slate-400">{fmtDate(r.lastDate)}</div></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {cmp.length > 0 && <p className="px-4 py-2 text-xs text-slate-500">Сравнивайте с учётом объёма: средняя по 2–3 небольшим поставкам менее показательна, чем по крупной партии.</p>}
          </Card>
          <Card
            title="Динамика закупочной цены (средневзвешенная по месяцам)"
            actions={
              <div className="flex gap-1 text-xs">
                {[6, 12].map((n) => (
                  <Link key={n} href={`${base}?tab=prices&period=${n}`} className={`rounded-md px-2 py-1 ${period === n ? "bg-brand-50 font-medium text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
                    {n} мес.
                  </Link>
                ))}
              </div>
            }
          >
            {all.length === 0 ? <Empty>Нет данных</Empty> : <PriceChart data={data} series={series} />}
          </Card>
        </div>
      )}
      {tab === "deliveries" && (
        <Card pad={false}>
          {all.length === 0 ? <Empty>Поставок нет</Empty> : (
            <Table>
              <thead><tr><Th>Дата</Th><Th>Поставщик</Th><Th>Заказ</Th><Th right>Кол-во</Th><Th right>Цена</Th><Th right>Сумма</Th></tr></thead>
              <tbody>
                {[...all].reverse().map((x, i) => (
                  <tr key={i}>
                    <Td>{fmtDate(x.date)}</Td>
                    <Td>{x.supplierName}</Td>
                    <Td><Link className="text-brand-700 hover:underline" href={`/orders/${x.orderId}`}>{orderNo(x.orderNumber)}</Link></Td>
                    <Td right>{fmtQty(x.qty)}</Td>
                    <Td right>{fmtPrice(x.price)}</Td>
                    <Td right>{fmtMoney(x.qty * x.price)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {tab === "orders" && <OrdersTab id={id} u={u} />}
      {tab === "plan" && (
        <Card pad={false}>
          {plan.length === 0 ? <Empty>Плана нет</Empty> : (
            <Table>
              <thead><tr><Th>Поставщик</Th><Th>Неделя</Th><Th right>Кол-во</Th><Th>Статус / примечание</Th></tr></thead>
              <tbody>{plan.map(({ e, s }) => <tr key={e.id}><Td>{s}</Td><Td>{e.weekStart ? fmtDate(e.weekStart) : "—"}</Td><Td right>{fmtQty(e.qty)}</Td><Td className="text-xs">{[e.status, e.note].filter(Boolean).join(" · ")}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
      {tab === "edit" && (
        <Card>
          {can(u, PERMS.productsEdit) ? (
            <ActionForm action={updateProductAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={id} />
              <Field label="Название" required><Input name="name" defaultValue={p.name} required /></Field>
              <Field label="Артикул"><Input name="sku" defaultValue={p.sku ?? ""} /></Field>
              <Field label="Категория"><Input name="category" defaultValue={p.category ?? ""} /></Field>
              <Field label="Единица измерения"><Input name="unit" defaultValue={p.unit} /></Field>
              <Field label="Описание" className="sm:col-span-2"><Textarea name="description" defaultValue={p.description ?? ""} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p.isActive} /> Товар активен</label>
              <div><SubmitButton>Сохранить</SubmitButton></div>
            </ActionForm>
          ) : <p className="text-sm text-slate-500">{p.description ?? "Описание не заполнено"}</p>}
        </Card>
      )}
      {tab === "history" && <HistoryBlock entityType="product" entityId={id} />}
    </>
  );
}

async function OrdersTab({ id, u }: { id: string; u: Awaited<ReturnType<typeof requireUser>> }) {
  const rows = await listOrders(u, { where: [sql`EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = o.id AND poi.product_id = ${id})`], limit: 200 });
  return (
    <Card pad={false}>
      {rows.length === 0 ? <Empty>Заказов нет</Empty> : (
        <Table>
          <thead><tr><Th>Заказ</Th><Th>Дата</Th><Th>Поставщик</Th><Th right>Сумма заказа</Th><Th right>Выполнение</Th><Th>Статус</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link className="text-brand-700 hover:underline" href={`/orders/${r.id}`}>{orderNo(r.number)}</Link></Td>
                <Td>{fmtDate(r.order_date)}</Td>
                <Td>{r.supplier_name}</Td>
                <Td right>{fmtMoney(r.amount)}</Td>
                <Td right>{fmtPct(Number(r.qty) ? (Number(r.delivered) / Number(r.qty)) * 100 : 0)}</Td>
                <Td><Badge tone={ORDER_STATUS_TONE[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
