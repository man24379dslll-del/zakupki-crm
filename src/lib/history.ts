/**
 * Подписи записей истории о поставках и оплатах: из общей суммы «420 ед.» — понятная строка,
 * а состав раскрывается по нажатию (src/components/log-entry.tsx). Чистые функции, покрыты тестами.
 */
import { fmtDate, fmtMoney, fmtQty, PAYMENT_METHOD_LABEL } from "./format";

export interface DeliveryLine {
  name: string;
  unit: string;
  qty: number;
  price: number | null;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

/** Сумма строк поставки; null — если ни у одной строки нет цены */
export function linesAmount(lines: { qty: number; price: number | null }[]): number | null {
  const priced = lines.filter((l) => l.price !== null);
  return priced.length ? priced.reduce((s, l) => s + l.qty * (l.price as number), 0) : null;
}

/** «Поставка 05.11.2026: Корвадинол — 420 шт.» или «Поставка 05.11.2026: 3 товара, 2 085 шт. на 312 400 ₽» */
export function deliveryHeadline(date: string, lines: DeliveryLine[]): string {
  const head = `Поставка ${fmtDate(date)}`;
  if (!lines.length) return head;
  if (lines.length === 1) return `${head}: ${lines[0].name} — ${fmtQty(lines[0].qty)} ${lines[0].unit}.`;
  const units = new Set(lines.map((l) => l.unit));
  const qty = units.size === 1 ? `, ${fmtQty(lines.reduce((s, l) => s + l.qty, 0))} ${lines[0].unit}.` : "";
  const sum = linesAmount(lines);
  return `${head}: ${lines.length} ${plural(lines.length, "товар", "товара", "товаров")}${qty}${sum !== null ? ` на ${fmtMoney(sum)}` : ""}`;
}

/** «Оплата 05.11.2026: 100 000 ₽, безнал» */
export function paymentHeadline(p: { date: string | null; amount: number; method: string }): string {
  return `Оплата ${p.date ? fmtDate(p.date) + ": " : ""}${fmtMoney(p.amount)}, ${(PAYMENT_METHOD_LABEL[p.method] ?? p.method).toLowerCase()}`;
}
