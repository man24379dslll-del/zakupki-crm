import Link from "next/link";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { orderScope, ITEM_STATS } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { addDays, addMonths, fmtDate, fmtQty, orderNo, today } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, btnClass, cn } from "@/components/ui";
import { FilterBar, FSelect, qp, withQuery, type SP } from "@/components/list";

export const metadata = { title: "Календарь поставок" };

const ACTIVE = sql`o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL')`;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const PER_CELL = 4;

interface Entry {
  kind: "order" | "plan";
  day: string;
  product: string;
  unit: string;
  qty: number;
  supplier: string;
  supplierId: string;
  orderId: string | null;
  number: number | null;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
};
const weekday = (iso: string) => (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7;
const monthTitle = (m: string) => {
  const s = new Date(m + "-01T00:00:00Z").toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).replace(/\s*г\.$/, "");
  return s[0].toUpperCase() + s.slice(1);
};

/** Ожидаемые поставки по плановой дате: недопоставленный остаток по каждой позиции + план поставок (не факт) */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const all = can(u, PERMS.ordersViewAll);
  const d = today();
  const month = /^\d{4}-\d{2}$/.test(qp(sp, "m")) ? qp(sp, "m") : d.slice(0, 7);
  const first = `${month}-01`;
  const gridStart = addDays(first, -weekday(first));
  const last = addDays(addMonths(first, 1), -1);
  const gridEnd = addDays(last, 6 - weekday(last));

  const sup = qp(sp, "supplier");
  const product = qp(sp, "product");
  const buyer = all ? qp(sp, "buyer") : "";
  const ow: SQL[] = [sql`o.deleted_at IS NULL`, orderScope(u), ACTIVE];
  if (sup) ow.push(sql`o.supplier_id = ${sup}`);
  if (product) ow.push(sql`ist.product_id = ${product}`);
  if (buyer) ow.push(sql`o.buyer_id = ${buyer}`);
  // план поставок не привязан к закупщику: видимость — через ответственных за поставщика
  const pw: SQL[] = [sql`pe.week_start BETWEEN ${gridStart}::date AND ${gridEnd}::date`, sql`pe.qty > 0`];
  if (sup) pw.push(sql`pe.supplier_id = ${sup}`);
  if (product) pw.push(sql`pe.product_id = ${product}`);
  const planUser = buyer || (all ? "" : u.id);
  if (planUser) pw.push(sql`EXISTS (SELECT 1 FROM supplier_buyers sb WHERE sb.supplier_id = pe.supplier_id AND sb.user_id = ${planUser})`);

  const [orders, plan, overdue, opts] = await Promise.all([
    db.execute(sql`
      WITH ${ITEM_STATS}
      SELECT 'order' AS kind, ist.due_date::text AS day, pr.name AS product, pr.unit, (ist.qty - ist.delivered)::float AS qty,
        s.name AS supplier, s.id AS supplier_id, o.id AS order_id, o.number
      FROM purchase_orders o
      JOIN suppliers s ON s.id = o.supplier_id
      JOIN item_stats ist ON ist.order_id = o.id AND NOT ist.is_closed AND ist.qty > ist.delivered
      JOIN products pr ON pr.id = ist.product_id
      WHERE ${sql.join(ow, sql` AND `)} AND ist.due_date BETWEEN ${gridStart}::date AND ${gridEnd}::date
      ORDER BY day, s.name, o.number, pr.name`),
    db.execute(sql`
      SELECT 'plan' AS kind, pe.week_start::text AS day, pr.name AS product, pr.unit, pe.qty::float AS qty,
        s.name AS supplier, s.id AS supplier_id, NULL AS order_id, NULL AS number
      FROM supply_plan_entries pe
      JOIN suppliers s ON s.id = pe.supplier_id AND s.deleted_at IS NULL
      JOIN products pr ON pr.id = pe.product_id
      WHERE ${sql.join(pw, sql` AND `)}
      ORDER BY day, s.name, pr.name`),
    db.execute(sql`
      WITH ${ITEM_STATS}
      SELECT COUNT(*)::int AS n, COUNT(DISTINCT o.id)::int AS orders FROM purchase_orders o
      JOIN item_stats ist ON ist.order_id = o.id AND NOT ist.is_closed AND ist.qty > ist.delivered
      WHERE ${sql.join(ow, sql` AND `)} AND ist.due_date < ${d}::date`),
    selectOptions(),
  ]);

  const entries = [...orders.rows, ...plan.rows].map((r) => {
    const x = r as Record<string, unknown>;
    return { kind: x.kind, day: x.day, product: x.product, unit: x.unit, qty: Number(x.qty), supplier: x.supplier, supplierId: x.supplier_id, orderId: x.order_id, number: x.number } as Entry;
  });
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const days: string[] = [];
  for (let x = gridStart; x <= gridEnd; x = addDays(x, 1)) days.push(x);
  const inMonth = (x: string) => x.startsWith(month);
  const monthEntries = entries.filter((e) => inMonth(e.day) && e.kind === "order");
  const selected = qp(sp, "d") && byDay.has(qp(sp, "d")) ? qp(sp, "d") : null;
  const od = overdue.rows[0] as { n: number; orders: number };
  const href = (patch: Record<string, string | null>) => withQuery("/calendar", sp, patch);

  return (
    <>
      <PageHeader
        title="Календарь поставок"
        subtitle="Что и в каком количестве мы ждём по плановым датам. В клетке — недопоставленный остаток."
        actions={
          <div className="flex items-center gap-1">
            <Link href={href({ m: addMonths(first, -1).slice(0, 7), d: null })} className={btnClass("secondary", "sm")} aria-label="Предыдущий месяц">←</Link>
            <Link href={href({ m: null, d: null })} className={btnClass("secondary", "sm")}>Сегодня</Link>
            <Link href={href({ m: addMonths(first, 1).slice(0, 7), d: null })} className={btnClass("secondary", "sm")} aria-label="Следующий месяц">→</Link>
          </div>
        }
      />
      <FilterBar base="/calendar" sp={sp} keep={["m"]}>
        <FSelect searchable name="supplier" sp={sp} placeholder="Все поставщики" options={opt(opts.suppliers)} />
        <FSelect searchable name="product" sp={sp} placeholder="Все товары" options={opt(opts.products)} className="w-full sm:w-72" />
        {all && <FSelect searchable name="buyer" sp={sp} placeholder="Все закупщики" options={opt(opts.buyers)} />}
      </FilterBar>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <h2 className="text-lg font-semibold text-slate-900">{monthTitle(month)}</h2>
        <span className="text-slate-600">ожидается в месяце: <b>{plural(monthEntries.length, "позиция", "позиции", "позиций")}</b></span>
        {od.n > 0 && (
          <Link href="/deliveries?when=overdue" className="text-rose-700 hover:underline">
            просрочено: <b>{plural(od.orders, "заказ", "заказа", "заказов")}</b> ({plural(od.n, "позиция", "позиции", "позиций")}) →
          </Link>
        )}
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-brand-500" />ожидается</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-rose-500" />просрочено</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-violet-500" />план (не факт)</span>
        </span>
      </div>

      {/* сетка месяца — на планшете и компьютере */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={cn("px-2 py-1.5 text-xs font-semibold uppercase text-slate-500", i > 4 && "text-slate-400")}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const list = byDay.get(day) ?? [];
            return (
              <div key={day} className={cn("min-h-32 border-slate-100 p-1.5", i % 7 !== 6 && "border-r", i < days.length - 7 && "border-b", !inMonth(day) && "bg-slate-50/70", selected === day && "bg-brand-50/60")}>
                <div className="mb-1 flex items-center justify-between">
                  <Link
                    href={`${href({ d: day })}#day`}
                    className={cn("flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold", day === d ? "bg-brand-600 text-white" : inMonth(day) ? "text-slate-700 hover:bg-slate-100" : "text-slate-400")}
                  >
                    {Number(day.slice(8))}
                  </Link>
                  {list.length > 0 && <span className="text-[11px] text-slate-400">{list.length} поз.</span>}
                </div>
                <div className="space-y-1">
                  {list.slice(0, PER_CELL).map((e, k) => (
                    <Chip key={k} e={e} overdue={e.kind === "order" && day < d} />
                  ))}
                  {list.length > PER_CELL && (
                    <Link href={`${href({ d: day })}#day`} className="block px-1 text-[11px] font-medium text-brand-700 hover:underline">
                      ещё {list.length - PER_CELL} →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* список по дням — на телефоне */}
      <div className="space-y-3 md:hidden">
        {days.filter((x) => inMonth(x) && byDay.has(x)).length === 0 ? (
          <Card><Empty>В этом месяце поставок не ожидается</Empty></Card>
        ) : (
          days
            .filter((x) => inMonth(x) && byDay.has(x))
            .map((day) => (
              <Card key={day} title={`${fmtDate(day)}, ${WEEKDAYS[weekday(day)]}`}>
                <div className="space-y-1">
                  {byDay.get(day)!.map((e, k) => (
                    <Chip key={k} e={e} overdue={e.kind === "order" && day < d} />
                  ))}
                </div>
              </Card>
            ))
        )}
      </div>

      {selected && <DayTable day={selected} list={byDay.get(selected)!} overdue={selected < d} />}
    </>
  );
}

function Chip({ e, overdue }: { e: Entry; overdue: boolean }) {
  const tone = e.kind === "plan" ? "bg-violet-50 text-violet-900 hover:bg-violet-100" : overdue ? "bg-rose-50 text-rose-900 hover:bg-rose-100" : "bg-brand-50 text-slate-800 hover:bg-brand-100";
  const href = e.orderId ? `/orders/${e.orderId}` : `/suppliers/${e.supplierId}?tab=plan`;
  return (
    <Link href={href} title={`${e.product} — ${fmtQty(e.qty)} ${e.unit}\n${e.supplier}${e.number ? `, ${orderNo(e.number)}` : ", план поставок"}`} className={cn("block rounded-md px-1.5 py-1 leading-tight", tone)}>
      <div className="truncate text-xs font-medium">{e.product}</div>
      <div className="truncate text-[11px] opacity-75">
        <b className="font-semibold">{fmtQty(e.qty)} {e.unit}</b> · {e.supplier}
      </div>
    </Link>
  );
}

function DayTable({ day, list, overdue }: { day: string; list: Entry[]; overdue: boolean }) {
  return (
    <Card title={<span id="day" className="scroll-mt-20">Поставки на {fmtDate(day)}</span>} className="mt-4" pad={false}>
      <Table>
        <thead>
          <tr>
            <Th>Товар</Th>
            <Th right>Ждём</Th>
            <Th>Поставщик</Th>
            <Th>Заказ</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {list.map((e, i) => (
            <tr key={i}>
              <Td>{e.product}</Td>
              <Td right className="whitespace-nowrap font-medium">{fmtQty(e.qty)} {e.unit}</Td>
              <Td>{e.supplier}</Td>
              <Td>
                {e.orderId ? (
                  <Link href={`/orders/${e.orderId}`} className="font-medium text-brand-700 hover:underline">{orderNo(e.number!)}</Link>
                ) : (
                  <Badge tone="violet">план</Badge>
                )}
                {overdue && e.kind === "order" && <span className="ml-2"><Badge tone="red">просрочено</Badge></span>}
              </Td>
              <Td>
                {e.orderId && (
                  <Link href={`/orders/${e.orderId}#deliver`} className="text-xs font-medium text-brand-700 hover:underline">Принять →</Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
