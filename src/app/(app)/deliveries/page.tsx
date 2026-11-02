import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { orderScope, ORDER_STATS, OVERDUE_SQL } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, fmtDate, fmtMoney, fmtQty, orderNo, today } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Progress, Table, Tabs, Td, Th } from "@/components/ui";
import { ExportLink, FDate, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, type SP } from "@/components/list";

export const metadata = { title: "Поставки" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const tab = qp(sp, "tab") || "expected";
  const opts = await selectOptions();
  const all = can(u, PERMS.ordersViewAll);
  return (
    <>
      <PageHeader title="Поставки" subtitle="Ожидаемые поставки и журнал фактических поступлений" actions={tab === "log" ? <ExportLink entity="deliveries" sp={sp} /> : undefined} />
      <Tabs
        base="/deliveries"
        current={tab}
        tabs={[
          { key: "expected", label: "Ожидаемые" },
          { key: "log", label: "Журнал поставок" },
        ]}
      />
      {tab === "expected" ? <Expected sp={sp} uId={u.id} all={all} opts={opts} u={u} /> : <Log sp={sp} all={all} opts={opts} u={u} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;
type Opts = Awaited<ReturnType<typeof selectOptions>>;

async function Expected({ sp, all, opts, u }: { sp: SP; uId: string; all: boolean; opts: Opts; u: U }) {
  const d = today();
  const w = [sql`o.deleted_at IS NULL`, orderScope(u), sql`o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL')`, sql`COALESCE(os.remaining,0) > 0`];
  const sup = qp(sp, "supplier");
  if (sup) w.push(sql`o.supplier_id = ${sup}`);
  const buyer = qp(sp, "buyer");
  if (buyer) w.push(sql`o.buyer_id = ${buyer}`);
  const when = qp(sp, "when");
  if (when === "overdue") w.push(OVERDUE_SQL(d));
  if (when === "week") w.push(sql`o.planned_delivery_date BETWEEN ${d}::date AND ${addDays(d, 7)}::date`);
  const q = qp(sp, "q");
  if (q) w.push(sql`(s.name ILIKE ${"%" + q + "%"} OR o.invoice_number ILIKE ${"%" + q + "%"} OR pr.name ILIKE ${"%" + q + "%"})`);
  const res = await db.execute(sql`
    WITH ${ORDER_STATS}
    SELECT o.id, o.number, o.order_date, o.planned_delivery_date, o.invoice_number, s.name AS supplier, u.name AS buyer,
      pr.name AS product, ist.qty, ist.delivered, ist.last_delivery, ${OVERDUE_SQL(d)} AS overdue
    FROM purchase_orders o
    JOIN suppliers s ON s.id = o.supplier_id
    LEFT JOIN users u ON u.id = o.buyer_id
    LEFT JOIN order_stats os ON os.order_id = o.id
    JOIN item_stats ist ON ist.order_id = o.id AND NOT ist.is_closed AND ist.qty > ist.delivered
    JOIN products pr ON pr.id = ist.product_id
    WHERE ${sql.join(w, sql` AND `)}
    ORDER BY overdue DESC, o.planned_delivery_date NULLS LAST, o.number
    LIMIT 500`);
  const rows = res.rows as { id: string; number: number; order_date: string; planned_delivery_date: string | null; invoice_number: string | null; supplier: string; buyer: string | null; product: string; qty: string; delivered: string; last_delivery: string | null; overdue: boolean }[];
  return (
    <>
      <FilterBar base="/deliveries" sp={sp} keep={["tab"]}>
        <SearchInput sp={sp} placeholder="Поставщик, счёт, товар" />
        <FSelect name="when" sp={sp} placeholder="Все сроки" options={[{ value: "overdue", label: "Просроченные" }, { value: "week", label: "На ближайшие 7 дней" }]} />
        <FSelect name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        {all && <FSelect name="buyer" sp={sp} placeholder="Все закупщики" options={opt(opts.buyers)} />}
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>Ожидаемых поставок нет</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th>Поставщик</Th>
                <Th>Товар</Th>
                <Th right>Ожидается</Th>
                <Th>Выполнение</Th>
                <Th>План. дата</Th>
                {all && <Th>Закупщик</Th>}
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = (Number(r.delivered) / Number(r.qty)) * 100;
                return (
                  <tr key={i}>
                    <Td>
                      <Link href={`/orders/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {orderNo(r.number)}
                      </Link>
                      <div className="text-xs text-slate-500">от {fmtDate(r.order_date)}{r.invoice_number && `, сч. ${r.invoice_number}`}</div>
                    </Td>
                    <Td className="max-w-48 truncate">{r.supplier}</Td>
                    <Td>{r.product}</Td>
                    <Td right>{fmtQty(Number(r.qty) - Number(r.delivered))}</Td>
                    <Td className="min-w-32">
                      <div className="mb-1 text-xs text-slate-500">
                        {fmtQty(r.delivered)} / {fmtQty(r.qty)}
                      </div>
                      <Progress value={pct} tone={r.overdue ? "red" : "brand"} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {fmtDate(r.planned_delivery_date)}
                      {r.overdue && (
                        <div>
                          <Badge tone="red">просрочено</Badge>
                        </div>
                      )}
                    </Td>
                    {all && <Td className="text-xs">{r.buyer ?? "—"}</Td>}
                    <Td>
                      <Link href={`/orders/${r.id}#deliver`} className="text-xs font-medium text-brand-700 hover:underline">
                        Принять →
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Log({ sp, all, opts, u }: { sp: SP; all: boolean; opts: Opts; u: U }) {
  const { page, limit, offset } = pageParams(sp);
  const w = [sql`d.deleted_at IS NULL`, sql`o.deleted_at IS NULL`, orderScope(u)];
  const sup = qp(sp, "supplier");
  if (sup) w.push(sql`d.supplier_id = ${sup}`);
  const buyer = qp(sp, "buyer");
  if (buyer) w.push(sql`o.buyer_id = ${buyer}`);
  const prod = qp(sp, "product");
  if (prod) w.push(sql`EXISTS (SELECT 1 FROM delivery_items x WHERE x.delivery_id = d.id AND x.product_id = ${prod})`);
  const from = qp(sp, "from");
  if (from) w.push(sql`d.date >= ${from}::date`);
  const to = qp(sp, "to");
  if (to) w.push(sql`d.date <= ${to}::date`);
  const q = qp(sp, "q");
  if (q) w.push(sql`(s.name ILIKE ${"%" + q + "%"} OR d.waybill_number ILIKE ${"%" + q + "%"} OR o.invoice_number ILIKE ${"%" + q + "%"})`);
  const res = await db.execute(sql`
    SELECT d.id, d.date, d.date_assumed, d.waybill_number, o.id AS order_id, o.number, s.name AS supplier, u.name AS who,
      (SELECT string_agg(pr.name || ': ' || trim(to_char(di.qty, 'FM999G999G990D###')), '; ') FROM delivery_items di JOIN products pr ON pr.id = di.product_id WHERE di.delivery_id = d.id) AS items,
      (SELECT SUM(di.qty) FROM delivery_items di WHERE di.delivery_id = d.id) AS qty,
      (SELECT SUM(di.qty * COALESCE(di.price,0)) FROM delivery_items di WHERE di.delivery_id = d.id) AS amount,
      COUNT(*) OVER()::int AS total
    FROM deliveries d JOIN purchase_orders o ON o.id = d.order_id JOIN suppliers s ON s.id = d.supplier_id
    LEFT JOIN users u ON u.id = d.created_by_id
    WHERE ${sql.join(w, sql` AND `)}
    ORDER BY d.date DESC, o.number DESC LIMIT ${limit} OFFSET ${offset}`);
  const rows = res.rows as { id: string; date: string; date_assumed: boolean; waybill_number: string | null; order_id: string; number: number; supplier: string; who: string | null; items: string; qty: string; amount: string; total: number }[];
  return (
    <>
      <FilterBar base="/deliveries" sp={sp} keep={["tab"]}>
        <SearchInput sp={sp} placeholder="Поставщик, накладная, счёт" />
        <FSelect name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        <FSelect name="product" sp={sp} placeholder="Все товары" options={opt(opts.products)} />
        {all && <FSelect name="buyer" sp={sp} placeholder="Все закупщики" options={opt(opts.buyers)} />}
        <FDate name="from" sp={sp} label="с" />
        <FDate name="to" sp={sp} label="по" />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>Поставок не найдено</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Заказ</Th>
                <Th>Поставщик</Th>
                <Th>Товары</Th>
                <Th right>Кол-во</Th>
                <Th right>Сумма</Th>
                <Th>Накладная</Th>
                <Th>Кто</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">
                    {fmtDate(r.date)}
                    {r.date_assumed && <div><Badge tone="amber">дата условная</Badge></div>}
                  </Td>
                  <Td>
                    <Link href={`/orders/${r.order_id}`} className="text-brand-700 hover:underline">
                      {orderNo(r.number)}
                    </Link>
                  </Td>
                  <Td className="max-w-48 truncate">{r.supplier}</Td>
                  <Td className="max-w-80 text-xs text-slate-600">{r.items}</Td>
                  <Td right>{fmtQty(r.qty)}</Td>
                  <Td right>{fmtMoney(r.amount)}</Td>
                  <Td>{r.waybill_number ?? "—"}</Td>
                  <Td className="text-xs text-slate-500">{r.who ?? "импорт"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/deliveries" sp={sp} total={rows[0]?.total ?? 0} page={page} size={limit} />
      </Card>
    </>
  );
}
