import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { orderScope, ORDER_STATS, OVERDUE_SQL } from "@/lib/services/orders";
import { addDays, fmtDate, fmtDateTime, fmtMoney, fmtQty, orderNo, today } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, Progress, Stat } from "@/components/ui";
import { ChangesView } from "@/components/blocks";
import { TaskList, TASK_FROM, TASK_SELECT, type TaskRow } from "./tasks/task-list";

export const metadata = { title: "Главная" };

export default async function Home() {
  const u = await requireUser();
  const d = today();
  const all = can(u, PERMS.ordersViewAll);
  const monthStart = d.slice(0, 8) + "01";

  const [kpi, deliveries, tasks, stats, activity] = await Promise.all([
    db.execute(sql`
      WITH ${ORDER_STATS}
      SELECT
        COUNT(*) FILTER (WHERE ${OVERDUE_SQL(d)})::int AS overdue,
        COUNT(*) FILTER (WHERE o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') AND COALESCE(os.remaining,0) > 0)::int AS expected,
        COUNT(*) FILTER (WHERE o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') AND os.next_due BETWEEN ${d}::date AND ${addDays(d, 7)}::date)::int AS week,
        COUNT(*) FILTER (WHERE o.status IN ('DRAFT','SENT','CONFIRMED','AWAITING','PARTIAL'))::int AS active,
        SUM(GREATEST(COALESCE(os.delivered_amount,0) - COALESCE(ps.paid,0), 0)) FILTER (WHERE o.status <> 'CANCELLED') AS debt
      FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id LEFT JOIN pay_stats ps ON ps.order_id = o.id
      WHERE o.deleted_at IS NULL AND ${orderScope(u)}`),
    db.execute(sql`
      WITH ${ORDER_STATS}
      SELECT o.id, o.number, COALESCE(os.next_due, o.planned_delivery_date) AS planned_delivery_date, s.name AS supplier, os.qty, os.delivered, os.remaining, ${OVERDUE_SQL(d)} AS overdue,
        (SELECT string_agg(pr.name, ', ') FROM item_stats i JOIN products pr ON pr.id = i.product_id WHERE i.order_id = o.id AND NOT i.is_closed AND i.qty > i.delivered) AS products
      FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN order_stats os ON os.order_id = o.id
      WHERE o.deleted_at IS NULL AND ${orderScope(u)} AND o.status IN ('SENT','CONFIRMED','AWAITING','PARTIAL') AND COALESCE(os.remaining,0) > 0
        AND (os.next_due IS NULL OR os.next_due <= ${addDays(d, 7)}::date)
      ORDER BY overdue DESC, os.next_due NULLS LAST LIMIT 12`),
    db.execute(sql`SELECT ${sql.raw(TASK_SELECT)} FROM ${sql.raw(TASK_FROM)}
      WHERE t.deleted_at IS NULL AND t.assignee_id = ${u.id} AND t.status IN ('NEW','IN_PROGRESS','WAITING')
      ORDER BY overdue DESC, t.due_date NULLS LAST LIMIT 20`),
    db.execute(sql`
      WITH ${ORDER_STATS}
      SELECT
        (SELECT COUNT(*) FROM purchase_orders o WHERE o.deleted_at IS NULL AND o.order_date >= ${monthStart}::date AND ${all ? sql`TRUE` : sql`o.buyer_id = ${u.id}`})::int AS orders,
        (SELECT COALESCE(SUM(os.amount),0) FROM purchase_orders o JOIN order_stats os ON os.order_id = o.id WHERE o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND o.order_date >= ${monthStart}::date AND ${all ? sql`TRUE` : sql`o.buyer_id = ${u.id}`}) AS amount,
        (SELECT COUNT(*) FROM deliveries dl JOIN purchase_orders o ON o.id = dl.order_id WHERE dl.deleted_at IS NULL AND dl.date >= ${monthStart}::date AND ${all ? sql`TRUE` : sql`o.buyer_id = ${u.id}`})::int AS deliveries,
        (SELECT COUNT(*) FROM tasks t WHERE t.status = 'DONE' AND t.completed_at >= ${monthStart}::date AND ${all ? sql`TRUE` : sql`t.assignee_id = ${u.id}`})::int AS tasks_done,
        (SELECT COUNT(*) FROM tasks t WHERE t.deleted_at IS NULL AND t.status IN ('NEW','IN_PROGRESS','WAITING') AND t.due_date < now() AND ${all ? sql`TRUE` : sql`t.assignee_id = ${u.id}`})::int AS tasks_overdue`),
    db.execute(sql`SELECT l.created_at, l.summary, l.entity_type, l.entity_id, l.changes, us.name AS who FROM activity_logs l LEFT JOIN users us ON us.id = l.user_id
      WHERE l.action <> 'login' AND ${all ? sql`TRUE` : sql`l.user_id = ${u.id}`} ORDER BY l.created_at DESC LIMIT 10`),
  ]);
  const k = kpi.rows[0] as { overdue: number; expected: number; week: number; active: number; debt: string | null };
  const dl = deliveries.rows as { id: string; number: number; planned_delivery_date: string | null; supplier: string; qty: string; delivered: string; remaining: string; overdue: boolean; products: string }[];
  const tk = tasks.rows as unknown as TaskRow[];
  const st = stats.rows[0] as { orders: number; amount: string; deliveries: number; tasks_done: number; tasks_overdue: number };
  const act = activity.rows as { created_at: string; summary: string; entity_type: string; entity_id: string; changes: unknown; who: string | null }[];
  const todayTasks = tk.filter((t) => t.overdue || (t.due_date && t.due_date.slice(0, 10) <= d) || t.due_soon);
  const otherTasks = tk.filter((t) => !todayTasks.includes(t));
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { hour: "numeric", timeZone: "Europe/Moscow" }).format(new Date()));
  const hello = hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const link = (t: string, id: string) => ({ order: `/orders/${id}`, supplier: `/suppliers/${id}`, task: `/tasks/${id}`, product: `/products/${id}`, user: `/users` })[t];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {hello}, {u.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Moscow" })}
            {all ? " · данные всего отдела" : " · ваши заказы и задачи"}
          </p>
        </div>
        {all && <LinkButton href="/analytics">Аналитика отдела →</LinkButton>}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Просроченные поставки" value={k.overdue} href="/deliveries?tab=expected&when=overdue" tone={k.overdue > 0 ? "red" : undefined} sub="план. дата прошла, товар не пришёл" />
        <Stat label="Ожидаемые поставки" value={k.expected} href="/deliveries?tab=expected" sub={`на ближайшие 7 дней: ${k.week}`} />
        <Stat label="Задачи на сегодня" value={todayTasks.length} href="/tasks?who=me&due=today" tone={tk.some((t) => t.overdue) ? "red" : undefined} sub={`${tk.filter((t) => t.overdue).length} просрочено · всего открыто ${tk.length}`} />
        <Stat label="Активные заказы" value={k.active} href="/orders?status=active" sub={`долг по отгрузке ${fmtMoney(k.debt ?? 0)}`} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card title="Сегодня" actions={u.role !== "VIEWER" && <Link href="/tasks/new" className="text-xs font-medium text-brand-700">+ задача</Link>} pad={false}>
          {todayTasks.length === 0 ? <Empty>На сегодня задач нет 👍</Empty> : <TaskList rows={todayTasks} canChange={u.role !== "VIEWER"} />}
          {otherTasks.length > 0 && (
            <>
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">Остальные открытые</div>
              <TaskList rows={otherTasks.slice(0, 6)} canChange={u.role !== "VIEWER"} />
            </>
          )}
        </Card>
        <Card title="Поставки: просроченные и на неделю" actions={<Link href="/deliveries" className="text-xs font-medium text-brand-700">все →</Link>} pad={false}>
          {dl.length === 0 ? (
            <Empty>Ожидаемых поставок на неделю нет</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dl.map((r) => {
                const pct = (Number(r.delivered) / Number(r.qty)) * 100;
                return (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/orders/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{orderNo(r.number)}</Link>
                        <span className="truncate text-slate-600">{r.supplier}</span>
                        {r.overdue ? <Badge tone="red">просрочено с {fmtDate(r.planned_delivery_date)}</Badge> : <Badge tone="amber">{r.planned_delivery_date ? `до ${fmtDate(r.planned_delivery_date)}` : "без срока"}</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{r.products}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Progress value={pct} tone={r.overdue ? "red" : "brand"} />
                        <span className="whitespace-nowrap text-xs text-slate-500">ждём {fmtQty(r.remaining)}</span>
                      </div>
                    </div>
                    {can(u, PERMS.ordersEdit) && (
                      <Link href={`/orders/${r.id}#deliver`} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                        Принять
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title={all ? "Отдел за текущий месяц" : "Моя статистика за месяц"}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Новых заказов", st.orders],
              ["На сумму", fmtMoney(st.amount)],
              ["Принято поставок", st.deliveries],
              ["Задач выполнено", st.tasks_done],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="text-xs text-slate-500">{l}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          {st.tasks_overdue > 0 && <p className="mt-3 text-sm text-rose-600">Просроченных задач: {st.tasks_overdue}</p>}
        </Card>
        <Card title="Последние действия" actions={can(u, PERMS.auditView) && <Link href="/settings?tab=audit" className="text-xs font-medium text-brand-700">журнал →</Link>}>
          {act.length === 0 ? <Empty>Пока пусто</Empty> : (
            <ul className="space-y-2.5">
              {act.map((a, i) => (
                <li key={i} className="text-sm">
                  <div className="text-xs text-slate-500">{fmtDateTime(a.created_at)}{all && ` · ${a.who ?? "система"}`}</div>
                  {link(a.entity_type, a.entity_id) ? <Link href={link(a.entity_type, a.entity_id)!} className="hover:text-brand-700">{a.summary}</Link> : a.summary}
                  <ChangesView changes={a.changes} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
