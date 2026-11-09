/**
 * Задача «Закупка»: какие заказы можно привязать и насколько закупка выполнена. Чистые функции, покрыты тестами.
 * Заказ подтверждает задачу, только если оформлен после её постановки: дата заказа не раньше дня задачи
 * И заказ создан в программе после задачи (иначе старый заказ можно было бы «подсунуть», поправив дату).
 */
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function linkError(task: { day: string; createdAt: number }, order: { orderDate: string; createdAt: number; status: string; deleted: boolean }): string | null {
  if (order.deleted) return "Заказ удалён";
  if (order.status === "CANCELLED") return "Заказ отменён — он не подтверждает закупку";
  if (order.orderDate < task.day) return `Дата заказа ${dmy(order.orderDate)} раньше даты задачи ${dmy(task.day)} — привязать нельзя`;
  if (order.createdAt < task.createdAt) return "Заказ оформлен в программе раньше, чем поставлена задача, — привязать можно только заказ, созданный после постановки задачи";
  return null;
}

export interface NeedItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  targetPrice: number | null;
}
export interface OrderLine {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number | null;
}
export interface CoverageRow extends NeedItem {
  ordered: number;
  rest: number;
  /** средняя цена по привязанным заказам (по строкам с ценой) */
  avgPrice: number | null;
}

export function purchaseCoverage(items: NeedItem[], lines: OrderLine[]) {
  const rows: CoverageRow[] = items.map((it) => {
    const my = lines.filter((l) => l.productId === it.productId);
    const ordered = my.reduce((s, l) => s + l.qty, 0);
    const priced = my.filter((l) => l.price !== null);
    const pq = priced.reduce((s, l) => s + l.qty, 0);
    return { ...it, ordered, rest: Math.max(it.qty - ordered, 0), avgPrice: pq ? Math.round((priced.reduce((s, l) => s + l.qty * (l.price as number), 0) / pq) * 100) / 100 : null };
  });
  const need = new Set(items.map((i) => i.productId));
  const extraMap = new Map<string, { productId: string; name: string; unit: string; qty: number }>();
  for (const l of lines.filter((x) => !need.has(x.productId))) {
    const e = extraMap.get(l.productId) ?? { productId: l.productId, name: l.name, unit: l.unit, qty: 0 };
    e.qty += l.qty;
    extraMap.set(l.productId, e);
  }
  const extra = [...extraMap.values()];
  return {
    rows,
    extra,
    /** заказано меньше, чем нужно, хотя бы по одному товару */
    short: rows.some((r) => r.rest > 0),
    /** цена выше ориентира хотя бы по одному товару */
    overTarget: rows.some((r) => r.targetPrice !== null && r.avgPrice !== null && r.avgPrice > r.targetPrice),
    complete: rows.length > 0 && rows.every((r) => r.rest === 0),
  };
}
