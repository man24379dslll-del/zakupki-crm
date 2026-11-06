import Link from "next/link";
import { fmtDate, fmtMoney, fmtPrice, fmtQty, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL } from "@/lib/format";
import { deliveryHeadline, linesAmount, paymentHeadline } from "@/lib/history";
import type { LogDetail } from "@/lib/services/log-details";
import { Badge } from "./ui";

/**
 * Текст записи истории. Для поставки и оплаты — понятная строка, по нажатию раскрывается состав
 * (что и сколько приняли, по какой цене; способ и № платёжки). Остальные записи — как были.
 */
export function LogEntry({ summary, detail, href }: { summary: string; detail?: LogDetail; href?: string | null }) {
  if (!detail) return href ? <Link href={href} className="text-slate-800 hover:text-brand-700">{summary}</Link> : <div className="text-slate-800">{summary}</div>;
  const head = detail.kind === "delivery" ? deliveryHeadline(detail.date, detail.lines) : paymentHeadline(detail);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-slate-800 hover:text-brand-700 [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block text-slate-400 transition group-open:rotate-90">▸</span>
        {head}
        {detail.deleted && (
          <span className="ml-2">
            <Badge tone="red">{detail.kind === "delivery" ? "поставка удалена" : "оплата удалена"}</Badge>
          </span>
        )}
      </summary>
      <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        {detail.kind === "delivery" ? <DeliveryDetail d={detail} /> : <PaymentDetail p={detail} />}
        {href && (
          <Link href={href} className="mt-1.5 inline-block text-brand-700 hover:underline">
            Открыть заказ →
          </Link>
        )}
      </div>
    </details>
  );
}

function DeliveryDetail({ d }: { d: Extract<LogDetail, { kind: "delivery" }> }) {
  const sum = linesAmount(d.lines);
  return (
    <>
      <table className="w-full tabular-nums">
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200 last:border-0">
              <td className="py-1 pr-2">{l.name}</td>
              <td className="whitespace-nowrap py-1 pr-2 text-right font-medium">{fmtQty(l.qty)} {l.unit}.</td>
              <td className="whitespace-nowrap py-1 pr-2 text-right text-slate-500">{l.price === null ? "без цены" : `× ${fmtPrice(l.price)}`}</td>
              <td className="whitespace-nowrap py-1 text-right">{l.price === null ? "—" : fmtMoney(l.qty * l.price)}</td>
            </tr>
          ))}
        </tbody>
        {d.lines.length > 1 && (
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-1">Итого</td>
              <td className="pt-1 text-right">{new Set(d.lines.map((l) => l.unit)).size === 1 ? `${fmtQty(d.lines.reduce((s, l) => s + l.qty, 0))} ${d.lines[0].unit}.` : ""}</td>
              <td />
              <td className="pt-1 text-right">{sum === null ? "—" : fmtMoney(sum)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500">
        <span>Дата поставки: {fmtDate(d.date)}{d.dateAssumed && " (условная)"}</span>
        {d.waybill && <span>Накладная № {d.waybill}</span>}
        {d.comment && <span>Комментарий: {d.comment}</span>}
      </div>
    </>
  );
}

function PaymentDetail({ p }: { p: Extract<LogDetail, { kind: "payment" }> }) {
  const rows: [string, string | null][] = [
    ["Сумма", fmtMoney(p.amount, 2)],
    ["Дата платежа", p.date ? fmtDate(p.date) : "не указана"],
    ["Способ", PAYMENT_METHOD_LABEL[p.method] ?? p.method],
    ["Тип", PAYMENT_TYPE_LABEL[p.type] ?? p.type],
    ["№ платёжного поручения", p.docNumber],
    ["Наше юрлицо", p.legal],
    ["Комментарий", p.comment],
    ...(p.orderId ? [] : ([["Заказ", "аванс без счёта"]] as [string, string][])),
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
