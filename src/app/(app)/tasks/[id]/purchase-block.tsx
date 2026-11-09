import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { orderScope } from "@/lib/services/orders";
import { productPriceCard } from "@/lib/services/prices";
import { purchaseCoverage } from "@/lib/purchase";
import { fmtDate, fmtMoney, fmtPrice, fmtQty, orderNo, ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/format";
import { Alert, Badge, Card, cn, LinkButton } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { Combobox } from "@/components/combobox";
import { linkTaskOrderAction, unlinkTaskOrderAction } from "../actions";

/**
 * Задача «Закупка»: что закупить, сколько уже заказано по привязанным заказам, цены против ориентира и средней за 6 мес.;
 * исполнитель создаёт заказ по задаче или привязывает свой заказ, оформленный после постановки задачи.
 */
export async function PurchaseBlock({ task, u }: { task: { id: string; status: string; assignee_id: string; creator_id: string; created_at: string }; u: SessionUser }) {
  const [itemsRes, ordersRes, linesRes] = await Promise.all([
    db.execute(sql`SELECT ti.product_id, pr.name, pr.unit, ti.qty, ti.target_price FROM task_items ti JOIN products pr ON pr.id = ti.product_id WHERE ti.task_id = ${task.id} ORDER BY ti.sort_order`),
    db.execute(sql`SELECT o.id, o.number, o.order_date, o.status, o.deleted_at IS NOT NULL AS deleted, s.name AS supplier, ub.name AS buyer,
        (SELECT SUM(poi.qty * COALESCE(poi.price,0)) FROM purchase_order_items poi WHERE poi.order_id = o.id) AS amount
      FROM task_orders x JOIN purchase_orders o ON o.id = x.order_id JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN users ub ON ub.id = o.buyer_id
      WHERE x.task_id = ${task.id} ORDER BY x.linked_at`),
    // строки привязанных заказов (отменённые и удалённые заказы закупку не подтверждают)
    db.execute(sql`SELECT poi.product_id, pr.name, pr.unit, poi.qty, poi.price FROM task_orders x JOIN purchase_orders o ON o.id = x.order_id
      JOIN purchase_order_items poi ON poi.order_id = o.id JOIN products pr ON pr.id = poi.product_id
      WHERE x.task_id = ${task.id} AND o.deleted_at IS NULL AND o.status <> 'CANCELLED'`),
  ]);
  const items = (itemsRes.rows as { product_id: string; name: string; unit: string; qty: string; target_price: string | null }[]).map((r) => ({ productId: r.product_id, name: r.name, unit: r.unit || "шт", qty: Number(r.qty), targetPrice: r.target_price === null ? null : Number(r.target_price) }));
  const orders = ordersRes.rows as { id: string; number: number; order_date: string; status: string; deleted: boolean; supplier: string; buyer: string | null; amount: string | null }[];
  const lines = (linesRes.rows as { product_id: string; name: string; unit: string; qty: string; price: string | null }[]).map((r) => ({ productId: r.product_id, name: r.name, unit: r.unit || "шт", qty: Number(r.qty), price: r.price === null ? null : Number(r.price) }));
  const cov = purchaseCoverage(items, lines);
  const avgs = new Map(await Promise.all(items.map(async (i) => [i.productId, (await productPriceCard(i.productId)).avg] as const)));

  const open = ["NEW", "IN_PROGRESS", "WAITING"].includes(task.status);
  const isAssignee = task.assignee_id === u.id;
  const canLink = open && (isAssignee || task.creator_id === u.id || can(u, PERMS.tasksAssign));
  // заказы, которые можно привязать: свои (по правам), оформленные после постановки задачи, не отменённые, ещё не привязанные
  const eligible = canLink
    ? ((await db.execute(sql`SELECT o.id, o.number, o.order_date, s.name AS supplier FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND ${orderScope(u)}
          AND o.created_at >= ${task.created_at}::timestamptz AND o.order_date >= (${task.created_at}::timestamptz AT TIME ZONE 'Europe/Moscow')::date
          AND NOT EXISTS (SELECT 1 FROM task_orders x WHERE x.task_id = ${task.id} AND x.order_id = o.id)
        ORDER BY o.created_at DESC LIMIT 100`)).rows as { id: string; number: number; order_date: string; supplier: string }[])
    : [];
  const pct = (a: number, b: number) => (Math.abs(a - b) / b < 0.0005 ? "на уровне" : `${a > b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`);

  return (
    <Card title="Закупка" actions={orders.length > 0 && <span className="text-xs text-slate-500">привязано заказов: {orders.length}</span>}>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="pb-1 pr-2 font-medium">Товар</th>
            <th className="pb-1 pr-2 text-right font-medium">Нужно</th>
            <th className="pb-1 pr-2 text-right font-medium">Заказано</th>
            <th className="pb-1 pr-2 text-right font-medium">Осталось</th>
            <th className="pb-1 text-right font-medium">Цена в заказах</th>
          </tr>
        </thead>
        <tbody>
          {cov.rows.map((r) => {
            const avg = avgs.get(r.productId) ?? null;
            return (
              <tr key={r.productId} className="border-t border-slate-100 align-top">
                <td className="py-1.5 pr-2">
                  <Link href={`/products/${r.productId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link>
                  <div className="text-xs text-slate-500">
                    {r.targetPrice !== null && <>ориентир {fmtPrice(r.targetPrice)}</>}
                    {r.targetPrice !== null && avg !== null && " · "}
                    {avg !== null && <>средняя за 6 мес. {fmtPrice(avg)}</>}
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-right">{fmtQty(r.qty)} {r.unit}.</td>
                <td className={cn("py-1.5 pr-2 text-right font-medium", r.ordered >= r.qty ? "text-emerald-700" : r.ordered > 0 ? "text-amber-700" : "text-slate-400")}>{fmtQty(r.ordered)}</td>
                <td className="py-1.5 pr-2 text-right">{r.rest > 0 ? fmtQty(r.rest) : "—"}</td>
                <td className="py-1.5 text-right">
                  {r.avgPrice === null ? "—" : fmtPrice(r.avgPrice)}
                  {r.avgPrice !== null && r.targetPrice !== null && <div className={cn("text-xs", r.avgPrice > r.targetPrice ? "text-rose-600" : "text-emerald-700")}>{pct(r.avgPrice, r.targetPrice) === "на уровне" ? "как ориентир" : `${pct(r.avgPrice, r.targetPrice)} к ориентиру`}</div>}
                  {r.avgPrice !== null && r.targetPrice === null && avg !== null && <div className={cn("text-xs", r.avgPrice > avg ? "text-rose-600" : "text-emerald-700")}>{pct(r.avgPrice, avg) === "на уровне" ? "как средняя" : `${pct(r.avgPrice, avg)} к средней`}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {orders.length > 0 && cov.short && <Alert tone="amber">Заказано меньше, чем нужно по задаче. Постановщик решит при согласовании, достаточно ли.</Alert>}
      {cov.extra.length > 0 && <Alert tone="amber">В заказах есть товары не из задачи: {cov.extra.map((e) => `${e.name} — ${fmtQty(e.qty)} ${e.unit}.`).join("; ")}.</Alert>}
      {cov.overTarget && <Alert tone="amber">Цена в заказах выше ориентира по задаче.</Alert>}

      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold text-slate-600">Заказы, которыми выполнена закупка</div>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-500">Пока не привязано ни одного заказа{open ? " — без заказа задачу нельзя сдать на согласование" : ""}.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Link href={`/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">{orderNo(o.number)}</Link>
                <span className="text-slate-500">от {fmtDate(o.order_date)}</span>
                <span className="text-slate-700">{o.supplier}</span>
                <span className="tabular-nums">{fmtMoney(o.amount ?? 0)}</span>
                {o.deleted ? <Badge tone="red">удалён</Badge> : <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>}
                {canLink && (
                  <span className="ml-auto">
                    <ConfirmButton action={unlinkTaskOrderAction} question="Отвязать заказ от задачи? Сам заказ останется." variant="secondary" hidden={{ id: task.id, orderId: o.id }}>
                      Отвязать
                    </ConfirmButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canLink && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          {can(u, PERMS.ordersEdit) && (
            <LinkButton href={`/orders/new?task=${task.id}`} variant="primary">
              Создать заказ по задаче
            </LinkButton>
          )}
          <ActionForm action={linkTaskOrderAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={task.id} />
            <div>
              <div className="mb-1 text-xs text-slate-500">или привязать уже оформленный заказ</div>
              <Combobox name="orderId" options={eligible.map((o) => ({ value: o.id, label: `${orderNo(o.number)} · ${o.supplier}`, hint: `от ${fmtDate(o.order_date)}` }))} placeholder={eligible.length ? "Выберите заказ" : "Подходящих заказов нет"} className="w-72" inputClassName="py-2" />
            </div>
            <SubmitButton size="sm" variant="secondary">Привязать заказ</SubmitButton>
          </ActionForm>
          <p className="w-full text-xs text-slate-500">В списке — только заказы, оформленные после постановки задачи ({fmtDate(task.created_at)}). Привязать можно несколько заказов.</p>
        </div>
      )}
    </Card>
  );
}
