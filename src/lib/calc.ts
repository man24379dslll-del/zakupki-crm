/** Чистые функции расчётов (без БД) — покрыты тестами в tests/calc.test.ts */
import { addMonths, today } from "./format";

export type WindowMode = "rolling" | "calendar";

export interface PricePoint {
  date: string;
  qty: number;
  price: number;
  supplierId: string;
  supplierName: string;
  orderId: string;
  orderNumber: number;
}

export interface ItemProgress {
  id: string;
  qty: number;
  delivered: number;
  isClosed: boolean;
}

/** Чистая функция: статус по позициям (используется и в тестах) */
export function computeStatus(current: string, items: ItemProgress[]): string {
  if (current === "CANCELLED") return current;
  const anyDelivered = items.some((i) => i.delivered > 0);
  if (!anyDelivered) {
    return current === "PARTIAL" || current === "DELIVERED" ? "AWAITING" : current;
  }
  const allDone = items.length > 0 && items.every((i) => i.isClosed || i.delivered >= i.qty);
  return allDone ? "DELIVERED" : "PARTIAL";
}

/** Проверка превышения заказанного количества. Возвращает список нарушений. */
export function checkOverDelivery(
  items: { id: string; qty: number; delivered: number; overDeliveryApproved: boolean; name?: string }[],
  add: Map<string, number>,
) {
  const issues: { itemId: string; name?: string; ordered: number; total: number }[] = [];
  for (const it of items) {
    const extra = add.get(it.id) ?? 0;
    if (!extra) continue;
    const total = it.delivered + extra;
    if (total > it.qty + 1e-9 && !it.overDeliveryApproved) issues.push({ itemId: it.id, name: it.name, ordered: it.qty, total });
  }
  return issues;
}

/** Окно в N месяцев: «скользящее» (от той же даты N месяцев назад) или N полных календарных месяцев */
export function priceWindow(months: number, mode: WindowMode, now = today()): { from: string; to: string } {
  if (mode === "calendar") {
    const firstThis = now.slice(0, 8) + "01";
    const from = addMonths(firstThis, -months);
    const to = new Date(new Date(firstThis + "T00:00:00Z").getTime() - 864e5).toISOString().slice(0, 10);
    return { from, to };
  }
  return { from: addMonths(now, -months), to: now };
}

export interface PriceStats {
  avg: number | null;
  min: number | null;
  max: number | null;
  qty: number;
  amount: number;
  deliveries: number;
}

/** Чистая функция расчёта (покрыта тестами) */
export function weightedStats(points: { qty: number; price: number | null }[]): PriceStats {
  let q = 0,
    a = 0,
    n = 0,
    min: number | null = null,
    max: number | null = null;
  for (const p of points) {
    if (p.price === null || p.price === undefined || !(p.qty > 0)) continue;
    q += p.qty;
    a += p.qty * p.price;
    n++;
    min = min === null ? p.price : Math.min(min, p.price);
    max = max === null ? p.price : Math.max(max, p.price);
  }
  return { avg: q > 0 ? a / q : null, min, max, qty: q, amount: a, deliveries: n };
}

export function lastAndPrev(points: { date: string; price: number }[]) {
  if (!points.length) return { lastPrice: null, lastDate: null, prevPrice: null, change: null };
  const last = points[points.length - 1];
  // предыдущая закупка = последняя поставка с более ранней датой
  const prev = [...points].reverse().find((p) => p.date < last.date);
  const change = prev && prev.price ? ((last.price - prev.price) / prev.price) * 100 : null;
  return { lastPrice: last.price, lastDate: last.date, prevPrice: prev?.price ?? null, change };
}

export interface SupplierCompareRow {
  supplierId: string;
  supplierName: string;
  avg: number | null;
  qty: number;
  amount: number;
  deliveries: number;
  lastPrice: number | null;
  lastDate: string | null;
  diffFromBest: number | null;
}

export function compareSuppliers(points: PricePoint[]): SupplierCompareRow[] {
  const by = new Map<string, PricePoint[]>();
  for (const p of points) {
    if (!by.has(p.supplierId)) by.set(p.supplierId, []);
    by.get(p.supplierId)!.push(p);
  }
  const rows = [...by.values()].map((ps) => {
    const s = weightedStats(ps);
    const l = lastAndPrev(ps);
    return { supplierId: ps[0].supplierId, supplierName: ps[0].supplierName, avg: s.avg, qty: s.qty, amount: s.amount, deliveries: s.deliveries, lastPrice: l.lastPrice, lastDate: l.lastDate, diffFromBest: null as number | null };
  });
  const best = Math.min(...rows.map((r) => r.avg ?? Infinity));
  for (const r of rows) r.diffFromBest = r.avg !== null && Number.isFinite(best) && best > 0 ? ((r.avg - best) / best) * 100 : null;
  return rows.sort((a, b) => (a.avg ?? Infinity) - (b.avg ?? Infinity));
}

/** Помесячная средневзвешенная цена за N месяцев (для графика) */
export function monthlySeries(points: PricePoint[], months: number, now = today()) {
  const out: { month: string; avg: number | null; qty: number }[] = [];
  const start = addMonths(now.slice(0, 8) + "01", -(months - 1));
  for (let i = 0; i < months; i++) {
    const m = addMonths(start, i).slice(0, 7);
    const ps = points.filter((p) => p.date.slice(0, 7) === m);
    const s = weightedStats(ps);
    out.push({ month: m, avg: s.avg !== null ? Math.round(s.avg * 100) / 100 : null, qty: s.qty });
  }
  return out;
}

