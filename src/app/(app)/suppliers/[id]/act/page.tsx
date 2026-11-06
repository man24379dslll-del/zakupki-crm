import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadAct, defaultLegal } from "@/lib/services/recon";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtPrice, fmtQty, today } from "@/lib/format";
import { rublesInWords } from "@/lib/money-words";
import { Alert, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { qp, type SP } from "@/components/list";

export const metadata = { title: "Акт сверки" };

const n2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m = (v: number) => (v ? n2.format(v) : "");

/** Акт сверки взаимных расчётов с поставщиком по нашим данным, с наименованиями товаров в каждой поставке */
export default async function ActPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(qp(sp, "from")) ? qp(sp, "from") : `${d.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(qp(sp, "to")) ? qp(sp, "to") : d;
  const legalParam = qp(sp, "legal");
  const legalId = legalParam === "all" ? null : legalParam || (await defaultLegal(id));
  const [act, opts] = await Promise.all([loadAct(u, id, legalId, from, to), selectOptions({ inactive: true })]);
  if (!act) notFound();
  // падежи для варианта «все юрлица»; у конкретного юрлица название не склоняем
  const our = act.legal ? `${act.legal.name}${act.legal.inn ? ` (ИНН ${act.legal.inn})` : ""}` : "нашей организацией (все юрлица)";
  const ourShort = act.legal?.name ?? "нашей организации";
  const ourNom = act.legal?.name ?? "наша организация";
  const sup = act.supplier.legalName || act.supplier.name;
  const supFull = `${sup}${act.supplier.inn ? ` (ИНН ${act.supplier.inn})` : ""}`;
  const qs = new URLSearchParams({ supplier: id, from, to, legal: legalId ?? "all" });
  const owe = act.closing > 0.004;
  const adv = act.closing < -0.004;
  const cell = "border border-slate-400 px-1.5 py-1 align-top";
  const num = `${cell} whitespace-nowrap text-right tabular-nums`;

  return (
    <>
      <div className="print:hidden">
        <PageHeader back={{ href: `/suppliers/${id}?tab=payments`, label: act.supplier.name }} title="Акт сверки взаимных расчётов" subtitle="По нашим данным, с товарами в каждой поставке. Половину поставщика он заполняет сам." />
        <Card className="mb-4">
          <form className="flex flex-wrap items-end gap-3" action={`/suppliers/${id}/act`}>
            <Field label="Период с"><Input type="date" name="from" defaultValue={from} className="w-40" /></Field>
            <Field label="по"><Input type="date" name="to" defaultValue={to} className="w-40" /></Field>
            <Field label="Наше юрлицо" className="min-w-64">
              <Select searchable name="legal" defaultValue={legalId ?? "all"} options={[{ value: "all", label: "Все наши юрлица" }, ...opt(opts.legal)]} />
            </Field>
            <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Сформировать</button>
            <span className="ml-auto flex gap-2">
              <a href={`/api/export/act?${qs}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Скачать Excel</a>
              <PrintButton />
            </span>
          </form>
        </Card>
        {act.unpricedLines > 0 && <Alert tone="amber">В {act.unpricedLines} строках товаров не указана цена — они показаны в акте, но в суммы не вошли. Проставьте цены в заказах, иначе итог будет занижен.</Alert>}
        {act.undatedPayments > 0 && <Alert tone="amber">Оплат без даты: {act.undatedPayments} — они не попали в акт. Укажите дату в журнале платежей.</Alert>}
        {act.withoutLegal > 0 && <Alert tone="amber">У {act.withoutLegal} поставок или оплат этого поставщика не указано наше юрлицо — в акт по выбранному юрлицу они не вошли. Выберите «Все наши юрлица», чтобы их увидеть.</Alert>}
        <div className="h-3" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 text-[13px] leading-snug text-slate-900 shadow-sm print:border-0 print:p-0 print:text-[11px] print:shadow-none">
        <div className="text-center">
          <div className="text-base font-bold">Акт сверки</div>
          <div>взаимных расчётов за период: {fmtDate(from)} – {fmtDate(to)}</div>
          <div>между {our}</div>
          <div>и {supFull}</div>
          {act.contract && <div>по договору{act.contract.number ? ` № ${act.contract.number}` : ""}{act.contract.date ? ` от ${fmtDate(act.contract.date)}` : ""}</div>}
        </div>
        <p className="mt-3">
          Мы, нижеподписавшиеся, {ourNom}, с одной стороны, и {sup}, с другой стороны, составили настоящий акт сверки в том, что состояние взаимных расчётов по данным учёта следующее:
        </p>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr>
              <th colSpan={4} className={`${cell} text-left font-semibold`}>По данным {ourShort}, руб.</th>
              <th colSpan={4} className={`${cell} text-left font-semibold`}>По данным {sup}, руб.</th>
            </tr>
            <tr className="text-left">
              {["Дата", "Документ", "Дебет", "Кредит", "Дата", "Документ", "Дебет", "Кредит"].map((h, i) => (
                <th key={i} className={`${cell} font-semibold ${h === "Дебет" || h === "Кредит" ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="font-semibold">
              <td className={cell} colSpan={2}>Сальдо начальное</td>
              <td className={num}>{act.opening < 0 ? n2.format(-act.opening) : ""}</td>
              <td className={num}>{act.opening > 0 ? n2.format(act.opening) : act.opening === 0 ? "0,00" : ""}</td>
              <td className={cell} colSpan={2}>Сальдо начальное</td>
              <td className={num} />
              <td className={num} />
            </tr>
            {act.rows.map((r, i) => (
              <tr key={i} className="break-inside-avoid">
                <td className={`${cell} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                <td className={cell}>
                  <div>{r.title}</div>
                  {r.lines && r.lines.length > 0 && (
                    <ul className="mt-0.5 text-[11px] text-slate-600 print:text-[10px]">
                      {r.lines.map((l, j) => (
                        <li key={j}>
                          {l.name} — {fmtQty(l.qty)} {l.unit}. × {l.price === null ? "цена не указана" : `${fmtPrice(l.price)} = ${n2.format(l.sum ?? 0)}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={num}>{m(r.debit)}</td>
                <td className={num}>{m(r.credit)}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={num} />
                <td className={num} />
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={cell} colSpan={2}>Обороты за период</td>
              <td className={num}>{n2.format(act.debit)}</td>
              <td className={num}>{n2.format(act.credit)}</td>
              <td className={cell} colSpan={2}>Обороты за период</td>
              <td className={num} />
              <td className={num} />
            </tr>
            <tr className="font-semibold">
              <td className={cell} colSpan={2}>Сальдо конечное</td>
              <td className={num}>{adv ? n2.format(-act.closing) : ""}</td>
              <td className={num}>{owe ? n2.format(act.closing) : !adv ? "0,00" : ""}</td>
              <td className={cell} colSpan={2}>Сальдо конечное</td>
              <td className={num} />
              <td className={num} />
            </tr>
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-2 gap-6 break-inside-avoid">
          <div>
            <div className="font-semibold">По данным {ourShort}</div>
            <div className="mt-1">
              {owe ? (
                <>на {fmtDate(to)} задолженность в пользу {sup} {n2.format(act.closing)} руб. ({rublesInWords(act.closing)}).</>
              ) : adv ? (
                <>на {fmtDate(to)} задолженность в пользу {ourShort} {n2.format(-act.closing)} руб. ({rublesInWords(-act.closing)}).</>
              ) : (
                <>на {fmtDate(to)} задолженность отсутствует.</>
              )}
            </div>
            <div className="mt-8">От {act.legal?.name ?? "нашей организации"}</div>
            <div className="mt-6">________________ / ________________</div>
            <div className="mt-1 text-[11px] text-slate-500">М.П.</div>
          </div>
          <div>
            <div className="font-semibold">По данным {sup}</div>
            <div className="mt-1">на {fmtDate(to)} задолженность в пользу ____________________ ________________ руб.</div>
            <div className="mt-8">От {sup}</div>
            <div className="mt-6">________________ / ________________</div>
            <div className="mt-1 text-[11px] text-slate-500">М.П.</div>
          </div>
        </div>

        {act.products.length > 0 && (
          <div className="mt-8 print:break-before-page">
            <div className="mb-2 font-semibold">Приложение: товары, поступившие за период {fmtDate(from)} – {fmtDate(to)}</div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className={`${cell} font-semibold`}>№</th>
                  <th className={`${cell} font-semibold`}>Наименование</th>
                  <th className={`${cell} text-right font-semibold`}>Количество</th>
                  <th className={`${cell} text-right font-semibold`}>Сумма, руб.</th>
                </tr>
              </thead>
              <tbody>
                {act.products.map((p, i) => (
                  <tr key={i} className="break-inside-avoid">
                    <td className={cell}>{i + 1}</td>
                    <td className={cell}>{p.name}{p.unpriced > 0 && <span className="text-amber-700"> (в {p.unpriced} поставк. без цены)</span>}</td>
                    <td className={num}>{fmtQty(p.qty)} {p.unit}.</td>
                    <td className={num}>{n2.format(p.sum)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={cell} colSpan={3}>Итого</td>
                  <td className={num}>{n2.format(act.products.reduce((s, p) => s + p.sum, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500 print:hidden">
        Дебет — наши оплаты поставщику, кредит — поступление товара по дате фактической приёмки. Сальдо по кредиту — мы должны поставщику. <Link href={`/suppliers/${id}?tab=payments`} className="text-brand-700 hover:underline">К поставщику</Link>
      </p>
    </>
  );
}
