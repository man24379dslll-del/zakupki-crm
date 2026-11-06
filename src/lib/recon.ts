/**
 * Акт сверки с поставщиком — чистые расчёты (покрыты тестами), данные собирает src/lib/services/recon.ts.
 * Акт составляется «по нашим данным» (мы — покупатель):
 *   Дебет  — наши оплаты поставщику; Кредит — поступление товара (поставки по сумме принятого).
 *   Сальдо по кредиту — мы должны поставщику, по дебету — аванс у поставщика.
 * Строки товаров без цены в сумму не входят (цена не указана ≠ 0) и считаются отдельно.
 */
export interface ActLine {
  name: string;
  unit: string;
  qty: number;
  price: number | null;
}
export interface ActDelivery {
  id: string;
  date: string;
  waybill: string | null;
  orderNo: string;
  lines: ActLine[];
}
export interface ActPayment {
  id: string;
  date: string | null;
  doc: string | null;
  amount: number;
  orderNo: string | null;
}
export interface ActRow {
  date: string;
  kind: "payment" | "delivery";
  title: string;
  debit: number;
  credit: number;
  lines?: (ActLine & { sum: number | null })[];
  unpriced?: number;
}
export interface ActResult {
  /** сальдо на начало: > 0 — мы должны поставщику (кредит), < 0 — аванс у поставщика (дебет) */
  opening: number;
  rows: ActRow[];
  debit: number;
  credit: number;
  closing: number;
  products: { name: string; unit: string; qty: number; sum: number; unpriced: number }[];
  unpricedLines: number;
  /** оплаты без даты — не попадают в период, показываем предупреждение */
  undatedPayments: number;
}

const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const deliveryAmount = (lines: ActLine[]) => round2(lines.reduce((s, l) => s + (l.price === null ? 0 : l.qty * l.price), 0));

export function buildAct(deliveries: ActDelivery[], payments: ActPayment[], from: string, to: string): ActResult {
  let opening = 0;
  const rows: ActRow[] = [];
  const prod = new Map<string, { name: string; unit: string; qty: number; sum: number; unpriced: number }>();
  let unpricedLines = 0;
  for (const d of deliveries) {
    const amount = deliveryAmount(d.lines);
    if (d.date < from) {
      opening += amount;
      continue;
    }
    if (d.date > to) continue;
    const unpriced = d.lines.filter((l) => l.price === null).length;
    unpricedLines += unpriced;
    for (const l of d.lines) {
      const key = `${l.name}|${l.unit}`;
      const p = prod.get(key) ?? { name: l.name, unit: l.unit, qty: 0, sum: 0, unpriced: 0 };
      p.qty += l.qty;
      if (l.price === null) p.unpriced += 1;
      else p.sum += l.qty * l.price;
      prod.set(key, p);
    }
    rows.push({
      date: d.date,
      kind: "delivery",
      title: d.waybill ? `Поступление (${/^\d/.test(d.waybill.trim()) ? `УПД ${d.waybill.trim()}` : d.waybill.trim()} от ${dmy(d.date)}), заказ ${d.orderNo}` : `Поступление от ${dmy(d.date)}, заказ ${d.orderNo}`,
      debit: 0,
      credit: amount,
      lines: d.lines.map((l) => ({ ...l, sum: l.price === null ? null : round2(l.qty * l.price) })),
      unpriced,
    });
  }
  let undatedPayments = 0;
  for (const p of payments) {
    if (!p.date) {
      undatedPayments++;
      continue;
    }
    if (p.date < from) {
      opening -= p.amount;
      continue;
    }
    if (p.date > to) continue;
    rows.push({
      date: p.date,
      kind: "payment",
      title: `${p.doc ? `Оплата (п/п ${p.doc} от ${dmy(p.date)})` : `Оплата от ${dmy(p.date)}`}${p.orderNo ? `, заказ ${p.orderNo}` : ", аванс без счёта"}`,
      debit: p.amount,
      credit: 0,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === b.kind ? a.title.localeCompare(b.title, "ru") : a.kind === "payment" ? -1 : 1));
  const debit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = round2(rows.reduce((s, r) => s + r.credit, 0));
  opening = round2(opening);
  return {
    opening,
    rows,
    debit,
    credit,
    closing: round2(opening + credit - debit),
    products: [...prod.values()].map((p) => ({ ...p, sum: round2(p.sum) })).sort((a, b) => a.name.localeCompare(b.name, "ru")),
    unpricedLines,
    undatedPayments,
  };
}
