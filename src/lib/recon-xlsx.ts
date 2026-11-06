import "server-only";
import ExcelJS from "exceljs";
import { fmtDate, fmtPrice, fmtQty } from "./format";
import { rublesInWords } from "./money-words";
import type { ActData } from "./services/recon";

/** Акт сверки в Excel: как в 1С — слева наши данные (с товарами под каждой поставкой), справа пустая половина поставщика; второй лист — товары за период */
export async function actXlsx(a: ActData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM закупок";
  const ws = wb.addWorksheet("Акт сверки", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = [{ width: 11 }, { width: 58 }, { width: 15 }, { width: 15 }, { width: 11 }, { width: 30 }, { width: 15 }, { width: 15 }];
  const our = a.legal?.name ?? "нашей организации";
  const ourNom = a.legal?.name ?? "наша организация";
  const ourInstr = a.legal?.name ?? "нашей организацией (все юрлица)";
  const sup = a.supplier.legalName || a.supplier.name;
  const money = "#,##0.00";
  const thin: Partial<ExcelJS.Borders> = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  const center = (text: string, bold = false) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, 8);
    r.getCell(1).alignment = { horizontal: "center" };
    if (bold) r.font = { bold: true, size: 12 };
  };
  center("Акт сверки", true);
  center(`взаимных расчётов за период: ${fmtDate(a.from)} – ${fmtDate(a.to)}`);
  center(`между ${ourInstr}${a.legal?.inn ? ` (ИНН ${a.legal.inn})` : ""}`);
  center(`и ${sup}${a.supplier.inn ? ` (ИНН ${a.supplier.inn})` : ""}`);
  if (a.contract) center(`по договору${a.contract.number ? ` № ${a.contract.number}` : ""}${a.contract.date ? ` от ${fmtDate(a.contract.date)}` : ""}`);
  ws.addRow([]);
  const intro = ws.addRow([`Мы, нижеподписавшиеся, ${ourNom}, с одной стороны, и ${sup}, с другой стороны, составили настоящий акт сверки в том, что состояние взаимных расчётов по данным учёта следующее:`]);
  ws.mergeCells(intro.number, 1, intro.number, 8);
  intro.getCell(1).alignment = { wrapText: true };
  intro.height = 30;
  ws.addRow([]);

  const head1 = ws.addRow([`По данным ${our}, руб.`, "", "", "", `По данным ${sup}, руб.`]);
  ws.mergeCells(head1.number, 1, head1.number, 4);
  ws.mergeCells(head1.number, 5, head1.number, 8);
  const head2 = ws.addRow(["Дата", "Документ", "Дебет", "Кредит", "Дата", "Документ", "Дебет", "Кредит"]);
  for (const r of [head1, head2]) r.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.border = thin; });

  const row = (vals: (string | number | Date | null)[], bold = false) => {
    const r = ws.addRow(vals);
    for (let i = 1; i <= 8; i++) {
      const c = r.getCell(i);
      c.border = thin;
      c.alignment = { vertical: "top", wrapText: i === 2 || i === 6 };
      if ([3, 4, 7, 8].includes(i)) c.numFmt = money;
      if (bold) c.font = { bold: true };
    }
    return r;
  };
  const dt = (d: string) => new Date(`${d}T00:00:00Z`);
  row(["Сальдо начальное", "", a.opening < 0 ? -a.opening : null, a.opening >= 0 ? a.opening : null, "Сальдо начальное", "", null, null], true);
  for (const r of a.rows) {
    const text = [r.title, ...(r.lines ?? []).map((l) => `   ${l.name} — ${fmtQty(l.qty)} ${l.unit}. × ${l.price === null ? "цена не указана" : `${fmtPrice(l.price)} = ${(l.sum ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}`)].join("\n");
    const x = row([dt(r.date), text, r.debit || null, r.credit || null, null, "", null, null]);
    x.getCell(1).numFmt = "dd.mm.yyyy";
    x.height = Math.max(15, 15 * (1 + (r.lines?.length ?? 0)));
  }
  row(["Обороты за период", "", a.debit, a.credit, "Обороты за период", "", null, null], true);
  row(["Сальдо конечное", "", a.closing < 0 ? -a.closing : null, a.closing >= 0 ? a.closing : null, "Сальдо конечное", "", null, null], true);
  ws.addRow([]);
  const owe = a.closing > 0.004;
  const adv = a.closing < -0.004;
  const verdict = owe
    ? `на ${fmtDate(a.to)} задолженность в пользу ${sup} ${a.closing.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб. (${rublesInWords(a.closing)}).`
    : adv
      ? `на ${fmtDate(a.to)} задолженность в пользу ${our} ${(-a.closing).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб. (${rublesInWords(-a.closing)}).`
      : `на ${fmtDate(a.to)} задолженность отсутствует.`;
  const side = (left: string, right: string, bold = false) => {
    const r = ws.addRow([left, "", "", "", right]);
    ws.mergeCells(r.number, 1, r.number, 4);
    ws.mergeCells(r.number, 5, r.number, 8);
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    r.getCell(5).alignment = { wrapText: true, vertical: "top" };
    if (bold) r.font = { bold: true };
    return r;
  };
  side(`По данным ${our}`, `По данным ${sup}`, true);
  side(verdict, `на ${fmtDate(a.to)} задолженность в пользу ____________________ ____________ руб.`).height = 45;
  ws.addRow([]);
  side(`От ${our}`, `От ${sup}`);
  ws.addRow([]);
  side("________________ / ________________", "________________ / ________________");
  side("М.П.", "М.П.");

  const ps = wb.addWorksheet("Товары за период");
  ps.columns = [{ header: "№", key: "n", width: 6 }, { header: "Наименование", key: "name", width: 50 }, { header: "Количество", key: "qty", width: 14 }, { header: "Ед.", key: "unit", width: 8 }, { header: "Сумма, руб.", key: "sum", width: 16 }, { header: "Поставок без цены", key: "unpriced", width: 18 }];
  a.products.forEach((p, i) => ps.addRow({ n: i + 1, name: p.name, qty: p.qty, unit: p.unit, sum: p.sum, unpriced: p.unpriced || null }));
  const tot = ps.addRow({ name: "Итого", sum: a.products.reduce((s, p) => s + p.sum, 0) });
  tot.font = { bold: true };
  ps.getRow(1).font = { bold: true };
  ps.getColumn("qty").numFmt = "#,##0.###";
  ps.getColumn("sum").numFmt = money;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
