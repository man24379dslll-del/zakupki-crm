import Link from "next/link";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { ORDER_STATS, OVERDUE_SQL } from "@/lib/services/orders";
import { pricePoints } from "@/lib/services/prices";
import { weightedStats } from "@/lib/calc";
import { opt, selectOptions } from "@/lib/services/refs";
import { addMonths, fmtMoney, fmtPct, today } from "@/lib/format";
import { Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { ExportLink, FDate, FilterBar, FSelect, qp, type SP } from "@/components/list";
import { MoneyBars } from "@/components/charts";

export const metadata = { title: "Аналитика" };

export default async function Analytics({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requirePerm(PERMS.statsViewAll);
  const d = today();
  const from = qp(sp, "from") || addMonths(d, -12);
  const to = qp(sp, "to") || d;
  const sup = qp(sp, "supplier");
  const buyer = qp(sp, "buyer");
  const product = qp(sp, "product");
  const f: SQL[] = [sql`o.deleted_at IS NULL`, sql`o.order_date BETWEEN ${from}::date AND ${to}::date`];
  if (sup) f.push(sql`o.supplier_id = ${sup}`);
  if (buyer) f.push(buyer === "none" ? sql`o.buyer_id IS NULL` : sql`o.buyer_id = ${buyer}`);
  if (product) f.push(sql`EXISTS (SELECT 1 FROM purchase_order_items x WHERE x.order_id = o.id AND x.product_id = ${product})`);
  const W = sql.join(f, sql` AND `);
  const opts = await selectOptions();

  const [kpiR, monthR, buyersR, suppliersR] = await Promise.all([
    db.execute(sql`WITH ${ORDER_STATS}
      SELECT COUNT(*)::int orders,
        SUM(os.amount) FILTER (WHERE o.status <> 'CANCELLED') amount,
        SUM(os.delivered_amount) delivered,
        COUNT(*) FILTER (WHERE o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') AND os.remaining > 0)::int expected,
        COUNT(*) FILTER (WHERE ${OVERDUE_SQL(d)})::int overdue,
        SUM(COALESCE(os.delivered_amount,0) - COALESCE(ps.paid,0)) FILTER (WHERE o.status <> 'CANCELLED') debt_ship,
        SUM(COALESCE(os.amount,0) - COALESCE(ps.paid,0)) FILTER (WHERE o.status <> 'CANCELLED') debt_order,
        COUNT(DISTINCT o.supplier_id) FILTER (WHERE o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') OR o.order_date >= ${addMonths(d, -3)}::date)::int active_suppliers,
        COUNT(DISTINCT o.buyer_id) FILTER (WHERE o.order_date >= ${addMonths(d, -3)}::date)::int active_buyers
      FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN pay_stats ps ON ps.order_id = o.id WHERE ${W}`),
    db.execute(sql`WITH m AS (
        SELECT to_char(o.order_date, 'YYYY-MM') m, SUM(poi.qty * COALESCE(poi.price,0)) ordered FROM purchase_orders o JOIN purchase_order_items poi ON poi.order_id = o.id
        WHERE ${W} AND o.status <> 'CANCELLED' GROUP BY 1),
      dd AS (
        SELECT to_char(dl.date, 'YYYY-MM') m, SUM(di.qty * COALESCE(di.price,0)) delivered FROM deliveries dl JOIN delivery_items di ON di.delivery_id = dl.id JOIN purchase_orders o ON o.id = dl.order_id
        WHERE dl.deleted_at IS NULL AND ${sql.join(f.filter((_, i) => i !== 1), sql` AND `)} AND dl.date BETWEEN ${from}::date AND ${to}::date GROUP BY 1),
      pp AS (
        SELECT to_char(p.date, 'YYYY-MM') m, SUM(p.amount) paid FROM payments p LEFT JOIN purchase_orders o ON o.id = p.order_id
        WHERE p.deleted_at IS NULL AND p.date BETWEEN ${from}::date AND ${to}::date ${sup ? sql`AND p.supplier_id = ${sup}` : sql``} ${buyer ? sql`AND o.buyer_id ${buyer === "none" ? sql`IS NULL` : sql`= ${buyer}`}` : sql``} GROUP BY 1)
      SELECT COALESCE(m.m, dd.m, pp.m) AS month, COALESCE(ordered,0)::float ordered, COALESCE(delivered,0)::float delivered, COALESCE(paid,0)::float paid
      FROM m FULL JOIN dd ON dd.m = m.m FULL JOIN pp ON pp.m = COALESCE(m.m, dd.m) ORDER BY 1`),
    db.execute(sql`WITH ${ORDER_STATS},
      o2 AS (SELECT o.buyer_id, COUNT(*) orders, SUM(os.amount) FILTER (WHERE o.status <> 'CANCELLED') amount, COUNT(*) FILTER (WHERE ${OVERDUE_SQL(d)}) overdue
        FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id WHERE ${W} GROUP BY o.buyer_id)
      SELECT u.id, u.name, COALESCE(o2.orders,0)::int orders, COALESCE(o2.amount,0) amount, COALESCE(o2.overdue,0)::int overdue_deliveries,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'DONE' AND t.completed_at BETWEEN ${from}::date AND ${to}::date + 1)::int tasks_done,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status IN ('NEW','IN_PROGRESS','WAITING') AND t.due_date < now())::int tasks_overdue,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status IN ('NEW','IN_PROGRESS','WAITING'))::int tasks_open
      FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN o2 ON o2.buyer_id = u.id
      WHERE u.is_active AND (r.code = 'BUYER' OR o2.orders > 0)
      UNION ALL
      SELECT NULL, 'Не назначен', COALESCE(o2.orders,0)::int, COALESCE(o2.amount,0), COALESCE(o2.overdue,0)::int, 0, 0, 0 FROM o2 WHERE o2.buyer_id IS NULL
      ORDER BY 4 DESC NULLS LAST`),
    db.execute(sql`WITH ${ORDER_STATS},
      lastd AS (SELECT dl.order_id, MAX(dl.date) last_date, MIN(dl.date) first_date FROM deliveries dl WHERE dl.deleted_at IS NULL GROUP BY 1),
      ontime AS (SELECT dl.order_id, SUM(di.qty) FILTER (WHERE dl.date <= o.planned_delivery_date) q_on, SUM(di.qty) q_all
        FROM deliveries dl JOIN delivery_items di ON di.delivery_id = dl.id JOIN purchase_orders o ON o.id = dl.order_id WHERE dl.deleted_at IS NULL AND o.planned_delivery_date IS NOT NULL GROUP BY 1)
      SELECT s.id, s.name, COUNT(*)::int orders, SUM(os.amount) FILTER (WHERE o.status <> 'CANCELLED') amount, SUM(os.delivered_amount) delivered,
        SUM(ot.q_on) q_on, SUM(ot.q_all) q_all,
        COUNT(*) FILTER (WHERE ${OVERDUE_SQL(d)} OR (ld.last_date > o.planned_delivery_date))::int delays,
        AVG(ld.first_date - o.order_date) FILTER (WHERE ld.first_date IS NOT NULL) lead_days
      FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN lastd ld ON ld.order_id = o.id LEFT JOIN ontime ot ON ot.order_id = o.id
      WHERE ${W} GROUP BY s.id ORDER BY amount DESC NULLS LAST`),
  ]);
  const k = kpiR.rows[0] as Record<string, string | number | null>;
  const months = monthR.rows as { month: string; ordered: number; delivered: number; paid: number }[];
  const buyers = buyersR.rows as { id: string | null; name: string; orders: number; amount: string; overdue_deliveries: number; tasks_done: number; tasks_overdue: number; tasks_open: number }[];
  const suppliers = suppliersR.rows as { id: string; name: string; orders: number; amount: string | null; delivered: string | null; q_on: string | null; q_all: string | null; delays: number; lead_days: string | null }[];

  // динамика стоимости: средневзвешенная цена последних 3 мес. к предыдущим 3 мес. по тем же товарам, взвешено по объёму
  const pts = await pricePoints((await db.execute(sql`SELECT DISTINCT product_id FROM delivery_items`)).rows.map((r) => (r as { product_id: string }).product_id), addMonths(d, -6), d);
  const mid = addMonths(d, -3);
  const dyn = new Map<string, number | null>();
  for (const s of suppliers) {
    const mine = pts.filter((p) => p.supplierId === s.id);
    let num = 0, den = 0;
    for (const pid of new Set(mine.map((p) => (p as { productId: string }).productId))) {
      const a = weightedStats(mine.filter((p) => (p as { productId: string }).productId === pid && p.date < mid));
      const b = weightedStats(mine.filter((p) => (p as { productId: string }).productId === pid && p.date >= mid));
      if (a.avg && b.avg) { num += ((b.avg - a.avg) / a.avg) * b.qty; den += b.qty; }
    }
    dyn.set(s.id, den ? (num / den) * 100 : null);
  }

  return (
    <>
      <PageHeader title="Аналитика отдела закупок" subtitle={`Заказы с ${from.split("-").reverse().join(".")} по ${to.split("-").reverse().join(".")}`} actions={<ExportLink entity="analytics" sp={sp} />} />
      <FilterBar base="/analytics" sp={sp}>
        <FDate name="from" sp={sp} label="с" />
        <FDate name="to" sp={sp} label="по" />
        <FSelect searchable name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        <FSelect searchable name="product" sp={sp} placeholder="Все товары" options={opt(opts.products)} />
        <FSelect searchable name="buyer" sp={sp} placeholder="Все закупщики" options={[{ value: "none", label: "Не назначен" }, ...opt(opts.buyers)]} />
      </FilterBar>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Заказов" value={k.orders} />
        <Stat label="Сумма заказов" value={fmtMoney(k.amount)} />
        <Stat label="Сумма фактических поставок" value={fmtMoney(k.delivered)} sub={Number(k.amount) ? `${fmtPct((Number(k.delivered) / Number(k.amount)) * 100)} от заказанного` : undefined} />
        <Stat label="Ожидаемые поставки" value={k.expected} sub="заказов с недопоставкой" />
        <Stat label="Просроченные поставки" value={k.overdue} tone={Number(k.overdue) > 0 ? "red" : undefined} href="/deliveries?tab=expected&when=overdue" />
        <Stat label="Долг по отгрузке" value={fmtMoney(k.debt_ship)} sub={`по заказам: ${fmtMoney(k.debt_order)}`} tone={Number(k.debt_ship) > 0 ? "amber" : undefined} />
        <Stat label="Активных поставщиков" value={k.active_suppliers} sub="заказы за 3 мес. или в работе" />
        <Stat label="Активных закупщиков" value={k.active_buyers} sub="оформляли заказы за 3 мес." />
      </div>
      <Card title="Заказано, поставлено и оплачено по месяцам" className="mb-4">
        {months.length ? <MoneyBars data={months} xKey="month" bars={[{ key: "ordered", name: "Заказано" }, { key: "delivered", name: "Поставлено" }, { key: "paid", name: "Оплачено" }]} /> : <Empty>Нет данных</Empty>}
      </Card>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Card title="Закупщики" pad={false}>
          <Table>
            <thead><tr><Th>Сотрудник</Th><Th right>Заказов</Th><Th right>Сумма закупок</Th><Th right>Задач выполнено</Th><Th right>Задач открыто</Th><Th right>Просроч. задач</Th><Th right>Просроч. поставок</Th></tr></thead>
            <tbody>
              {buyers.map((b) => (
                <tr key={b.id ?? "none"}>
                  <Td>{b.id ? <Link href={`/orders?buyer=${b.id}`} className="hover:text-brand-700">{b.name}</Link> : <span className="text-slate-500">{b.name}</span>}</Td>
                  <Td right>{b.orders}</Td>
                  <Td right>{fmtMoney(b.amount)}</Td>
                  <Td right>{b.tasks_done}</Td>
                  <Td right>{b.tasks_open}</Td>
                  <Td right className={b.tasks_overdue ? "font-medium text-rose-600" : ""}>{b.tasks_overdue}</Td>
                  <Td right className={b.overdue_deliveries ? "font-medium text-rose-600" : ""}>{b.overdue_deliveries}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Поставщики" pad={false}>
          <Table>
            <thead><tr><Th>Поставщик</Th><Th right>Объём закупок</Th><Th right>Поставлено</Th><Th right>Динамика цен</Th><Th right>Вовремя</Th><Th right>Задержек</Th><Th right>Срок до 1-й поставки</Th></tr></thead>
            <tbody>
              {suppliers.map((s) => {
                const dy = dyn.get(s.id);
                return (
                  <tr key={s.id}>
                    <Td className="max-w-56 truncate"><Link className="hover:text-brand-700" href={`/suppliers/${s.id}?tab=prices`}>{s.name}</Link><div className="text-xs text-slate-500">{s.orders} зак.</div></Td>
                    <Td right>{fmtMoney(s.amount)}</Td>
                    <Td right>{fmtMoney(s.delivered)}</Td>
                    <Td right className={dy && dy > 0.5 ? "text-rose-600" : dy && dy < -0.5 ? "text-emerald-700" : ""} >{dy === null || dy === undefined ? "—" : `${dy > 0 ? "+" : ""}${dy.toFixed(1)}%`}</Td>
                    <Td right>{s.q_all && Number(s.q_all) ? fmtPct((Number(s.q_on) / Number(s.q_all)) * 100) : "—"}</Td>
                    <Td right className={s.delays ? "text-amber-700" : ""}>{s.delays}</Td>
                    <Td right>{s.lead_days ? `${Math.round(Number(s.lead_days))} дн.` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-4 py-2 text-xs text-slate-500">
            Динамика цен — изменение средневзвешенной цены последних 3 месяцев к предыдущим 3 по тем же товарам. «Вовремя» — доля количества, поставленного не позже плановой даты. Задержка — заказ, просроченный сейчас или с поставкой после плановой даты.
          </p>
        </Card>
      </div>
    </>
  );
}
