/**
 * Парсер исходного Excel «УчетЗАКАЗов.xlsx».
 * Распознаёт три формата листов и приводит их к единой промежуточной структуре,
 * которую затем проверяет и импортирует importer.ts.
 *
 *  - "main"    — основные таблицы: строки товаров + строки оплат, поставки по столбцам с датами в строке над заголовком;
 *  - "simple"  — «ост.поставщики»: одна строка = один счёт (аванс, отгрузка, полный расчёт);
 *  - "plan"    — «ПРИБОРЫ»: понедельный график поставок по поставщикам/аппаратам.
 */
import ExcelJS from "exceljs";

export type SheetKind = "main" | "simple" | "plan" | "unknown";

export interface ColumnMapping {
  direction?: number;
  legalEntity?: number;
  supplier?: number;
  product?: number;
  orderDate?: number;
  invoice?: number;
  qty?: number;
  price?: number;
  amount?: number;
  deliveryFrom?: number;
  deliveryTo?: number;
  paymentDoc?: number;
  paymentDate?: number;
  paymentAmount?: number;
  note?: number;
  remainder?: number;
  // simple format
  invoiceDate?: number;
  advanceDate?: number;
  advanceDoc?: number;
  advanceAmount?: number;
  shipDate?: number;
  shipAmount?: number;
  shipQty?: number;
  finalDoc?: number;
  finalDate?: number;
  finalAmount?: number;
  // plan format
  dateFrom?: number;
  dateTo?: number;
}

export type IssueLevel = "error" | "warning" | "info";
export interface Issue {
  level: IssueLevel;
  sheet: string;
  row?: number;
  cell?: string;
  code: string;
  message: string;
}

export interface ParsedDelivery {
  date: string | null; // ISO date
  qty: number;
  cell: string;
  fromFormula?: string;
}

export interface ParsedItem {
  row: number;
  product: string;
  qty: number | null;
  price: number | null;
  amount: number | null;
  deliveries: ParsedDelivery[];
  note?: string;
  closedManually?: boolean;
  direction?: string | null;
}

export interface ParsedPayment {
  row: number;
  date: string | null;
  amount: number;
  doc?: string;
  note?: string;
  kind?: "advance" | "final" | "payment";
}

export interface ParsedOrder {
  key: string;
  sheet: string;
  firstRow: number;
  lastRow: number;
  direction: string | null;
  legalEntity: string | null;
  supplier: string | null;
  invoice: string | null;
  orderDate: string | null;
  note?: string;
  items: ParsedItem[];
  payments: ParsedPayment[];
}

export interface ParsedPlanRow {
  row: number;
  supplier: string;
  legalEntity: string | null;
  product: string;
  weeks: { date: string; qty: number }[];
  status: string | null; // текст вместо количеств («тесты продаж», «не дают эксклюзив»)
  note: string | null;
}

export interface ParsedSheet {
  name: string;
  kind: SheetKind;
  headerRow: number;
  mapping: ColumnMapping;
  deliveryDates: { col: number; letter: string; date: string | null }[];
  orders: ParsedOrder[];
  supplierPayments: (ParsedPayment & { supplier: string | null; legalEntity: string | null })[];
  plan: ParsedPlanRow[];
  skippedRows: { row: number; reason: string }[];
  issues: Issue[];
  /** контрольные итоги, посчитанные самим Excel (строка «ИТОГО»), для сверки */
  excelTotals?: { qty?: number; amount?: number; delivered?: number; paid?: number };
}

export interface ParseResult {
  fileName: string;
  sheets: ParsedSheet[];
}

// ---------- helpers ----------

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Raw = ExcelJS.CellValue;

function unwrap(v: Raw): { value: unknown; formula?: string } {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      return { value: o.result ?? null, formula: String(o.formula ?? o.sharedFormula ?? "") };
    }
    if ("richText" in o) return { value: (o.richText as { text: string }[]).map((t) => t.text).join("") };
    if ("text" in o) return { value: o.text };
    if ("error" in o) return { value: null };
  }
  return { value: v };
}

function cellVal(ws: ExcelJS.Worksheet, r: number, c?: number) {
  if (!c) return { value: null as unknown };
  return unwrap(ws.getCell(r, c).value);
}

export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/\s/g, "").replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

export function toDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // exceljs отдаёт даты в UTC полночь
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

function norm(s: unknown): string {
  return (toStr(s) ?? "").toLowerCase().replace(/ё/g, "е");
}

/** Значения, которые в колонке «Контрагент»/«Юрлицо» означают способ оплаты, а не организацию */
const NON_ENTITY = new Set(["нал", "наличные", "бн", "б/н"]);

function entity(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  if (NON_ENTITY.has(s.toLowerCase())) return null;
  return s;
}

function invoiceStr(v: unknown): string | null {
  const s = toStr(v);
  if (!s || s === "-" || s === "—") return null;
  // 103.0 -> "103"
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, "");
  return s;
}

// ---------- detection ----------

function rowTexts(ws: ExcelJS.Worksheet, r: number): Map<number, string> {
  const m = new Map<number, string>();
  const row = ws.getRow(r);
  row.eachCell({ includeEmpty: false }, (cell, c) => {
    const s = norm(unwrap(cell.value).value);
    if (s) m.set(c, s);
  });
  return m;
}

export function detectSheet(ws: ExcelJS.Worksheet): { kind: SheetKind; headerRow: number } {
  for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
    const t = [...rowTexts(ws, r).values()];
    if (t.includes("наименование") && t.some((x) => x.startsWith("кол-во поставки"))) return { kind: "main", headerRow: r };
    if (t.includes("кол-во заказа") && t.some((x) => x.startsWith("сумма аванса"))) return { kind: "simple", headerRow: r };
    if (t.includes("поставщик") && t.includes("аппарат")) return { kind: "plan", headerRow: r };
  }
  return { kind: "unknown", headerRow: 0 };
}

function findCol(h: Map<number, string>, ...variants: string[]): number | undefined {
  for (const v of variants) {
    for (const [c, s] of h) if (s === v) return c;
  }
  for (const v of variants) {
    for (const [c, s] of h) if (s.startsWith(v)) return c;
  }
  return undefined;
}

export function autoMapping(ws: ExcelJS.Worksheet, kind: SheetKind, headerRow: number): ColumnMapping {
  const h = rowTexts(ws, headerRow);
  if (kind === "main") {
    const delivCols = [...h].filter(([, s]) => s === "кол-во поставки").map(([c]) => c);
    const totalCol = findCol(h, "кол-во поставки итого");
    return {
      direction: findCol(h, "направление"),
      legalEntity: findCol(h, "наше юрлицо"),
      supplier: findCol(h, "контрагент"),
      product: findCol(h, "наименование"),
      orderDate: findCol(h, "дата заказа"),
      invoice: findCol(h, "счет №", "счёт №"),
      qty: findCol(h, "кол-во"),
      price: findCol(h, "цена закупки"),
      amount: findCol(h, "сумма"),
      deliveryFrom: delivCols.length ? Math.min(...delivCols) : undefined,
      // ВАЖНО: столбцы поставок продолжаются и после последнего подписанного заголовка — до «ИТОГО»
      deliveryTo: totalCol ? totalCol - 1 : delivCols.length ? Math.max(...delivCols) : undefined,
      paymentDoc: findCol(h, "пп"),
      paymentDate: findCol(h, "дата оплаты"),
      paymentAmount: findCol(h, "сумма оплаты"),
      note: findCol(h, "примечание"),
      remainder: findCol(h, "остаток неотгруженный"),
    };
  }
  if (kind === "simple") {
    // два столбца «номер ПП»: первый — аванс, второй — полный расчёт
    const ppCols = [...h].filter(([, s]) => s === "номер пп").map(([c]) => c).sort((a, b) => a - b);
    return {
      direction: findCol(h, "направление"),
      legalEntity: findCol(h, "наше юрлицо"),
      supplier: findCol(h, "контрагент"),
      qty: findCol(h, "кол-во заказа"),
      invoiceDate: findCol(h, "дата счета", "дата счёта"),
      invoice: findCol(h, "счет №", "счёт №"),
      amount: findCol(h, "сумма заказа"),
      advanceDate: findCol(h, "дата аванса"),
      advanceDoc: ppCols[0],
      advanceAmount: findCol(h, "сумма аванса"),
      shipDate: findCol(h, "дата поставки"),
      shipAmount: findCol(h, "сумма отгрузки"),
      shipQty: findCol(h, "кол-во поставки"),
      finalDoc: ppCols[1],
      finalDate: findCol(h, "дата полного расчета", "дата полного расчёта"),
      finalAmount: findCol(h, "сумма полного расчета", "сумма полного расчёта"),
      note: findCol(h, "примечание"),
    };
  }
  if (kind === "plan") {
    let first: number | undefined, last: number | undefined;
    ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, c) => {
      const d = toDate(unwrap(cell.value).value);
      if (d) {
        first = first ?? c;
        last = c;
      }
    });
    return {
      supplier: findCol(h, "поставщик"),
      legalEntity: findCol(h, "наше ип", "наше юрлицо"),
      product: findCol(h, "аппарат", "наименование"),
      dateFrom: first,
      dateTo: last,
    };
  }
  return {};
}

// ---------- parsing ----------

function parseMain(ws: ExcelJS.Worksheet, sheet: ParsedSheet) {
  const m = sheet.mapping;
  const hr = sheet.headerRow;
  const issues = sheet.issues;
  const dateRow = hr - 1;

  // даты поставок по столбцам
  if (m.deliveryFrom && m.deliveryTo) {
    for (let c = m.deliveryFrom; c <= m.deliveryTo; c++) {
      const d = toDate(cellVal(ws, dateRow, c).value);
      sheet.deliveryDates.push({ col: c, letter: colLetter(c), date: d });
    }
  }
  const dateByCol = new Map(sheet.deliveryDates.map((d) => [d.col, d.date]));

  // проверка: формула «ИТОГО поставки» охватывает не все столбцы поставок
  if (m.deliveryTo) {
    const totalCol = m.deliveryTo + 1;
    const ranges = new Map<string, number[]>();
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      const f = cellVal(ws, r, totalCol).formula;
      const mm = f?.match(/SUM\(([A-Z]+)\d+:([A-Z]+)\d+\)/i);
      if (mm) {
        const k = `${mm[1]}:${mm[2]}`;
        if (!ranges.has(k)) ranges.set(k, []);
        ranges.get(k)!.push(r);
      }
    }
    const lastLetter = colLetter(m.deliveryTo);
    for (const [k, rows] of ranges) {
      const end = k.split(":")[1];
      if (end !== lastLetter) {
        issues.push({
          level: "warning",
          sheet: sheet.name,
          code: "EXCEL_TOTAL_RANGE",
          message: `Формула «Кол-во поставки ИТОГО» в ${rows.length} строках суммирует только ${k}, а столбцы поставок идут до ${lastLetter}. Итоги в Excel могут быть занижены — система считает по всем столбцам.`,
        });
      }
    }
  }

  let current: ParsedOrder | null = null;
  let seenPaymentInCurrent = false;
  let lastSupplier: string | null = null;
  let lastEntity: string | null = null;
  // контрагент по умолчанию для листа — самый частый в столбце «Контрагент»
  const freq = new Map<string, number>();
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const s = entity(cellVal(ws, r, m.supplier).value);
    if (s) freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  let sheetSupplier = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!sheetSupplier) {
    sheetSupplier = sheet.name;
    issues.push({ level: "warning", sheet: sheet.name, code: "SUPPLIER_FROM_SHEET", message: `В столбце «Контрагент» нет организации (только «нал»/пусто). Поставщиком будет «${sheet.name}» — укажите реальное название при импорте.` });
  }

  const close = () => {
    if (current && (current.items.length || current.payments.length)) sheet.orders.push(current);
    current = null;
    seenPaymentInCurrent = false;
  };

  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const product = toStr(cellVal(ws, r, m.product).value);
    const qty = toNum(cellVal(ws, r, m.qty).value);
    const price = toNum(cellVal(ws, r, m.price).value);
    const amountCell = cellVal(ws, r, m.amount);
    const payAmount = toNum(cellVal(ws, r, m.paymentAmount).value);
    const payDateRaw = cellVal(ws, r, m.paymentDate).value;
    const invoice = invoiceStr(cellVal(ws, r, m.invoice).value);
    const supplierRaw = entity(cellVal(ws, r, m.supplier).value);
    const entityRaw = entity(cellVal(ws, r, m.legalEntity).value);
    const direction = toStr(cellVal(ws, r, m.direction).value);
    const orderDate = toDate(cellVal(ws, r, m.orderDate).value);
    const note = toStr(cellVal(ws, r, m.note).value) ?? undefined;
    if (supplierRaw) lastSupplier = supplierRaw;
    if (entityRaw) lastEntity = entityRaw;

    // поставки в строке
    const deliveries: ParsedDelivery[] = [];
    if (m.deliveryFrom && m.deliveryTo) {
      for (let c = m.deliveryFrom; c <= m.deliveryTo; c++) {
        const cv = cellVal(ws, r, c);
        const q = toNum(cv.value);
        if (q === null || q === 0) {
          const s = toStr(cv.value);
          if (s && q === null) issues.push({ level: "warning", sheet: sheet.name, row: r, cell: colLetter(c) + r, code: "DELIVERY_NOT_NUMBER", message: `Нечисловое значение поставки «${s}» — пропущено.` });
          continue;
        }
        deliveries.push({ date: dateByCol.get(c) ?? null, qty: q, cell: colLetter(c) + r, fromFormula: cv.formula });
      }
    }

    // строка с количеством/ценой, но без наименования — позиция без названия (например, услуга или упаковка)
    const unnamed = !product && qty !== null && qty !== 0 && price !== null;
    const isItem = !!product || unnamed;
    const isPayment = !isItem && payAmount !== null && payAmount !== 0;

    if (isItem) {
      const name = product ?? `Без наименования (лист «${sheet.name}», стр. ${r})`;
      if (unnamed) issues.push({ level: "error", sheet: sheet.name, row: r, code: "ITEM_NO_NAME", message: `Строка ${r}: количество ${qty} и цена ${price}, но нет наименования товара${supplierRaw ? ` (контрагент ${supplierRaw})` : ""}. Будет создан товар «${name}» — переименуйте.` });
      const supplier = supplierRaw ?? lastSupplier ?? sheetSupplier;
      const key = [supplier, entityRaw ?? lastEntity, invoice, orderDate].join("|");
      if (!current || current.key !== key || seenPaymentInCurrent) {
        close();
        current = {
          key,
          sheet: sheet.name,
          firstRow: r,
          lastRow: r,
          direction,
          legalEntity: entityRaw ?? null,
          supplier,
          invoice,
          orderDate,
          items: [],
          payments: [],
        };
      }
      current.lastRow = r;
      if (!current.direction && direction) current.direction = direction;
      const amount = toNum(amountCell.value);
      // «остаток неотгруженный» перезаписан числом вместо формулы — позицию вручную закрыли
      const remCell = m.remainder ? cellVal(ws, r, m.remainder) : null;
      const closedManually = !!remCell && !remCell.formula && toNum(remCell.value) !== null;
      // строки с товаром без количества и без поставок — «пустые» позиции-заготовки
      if ((qty === null || qty === 0) && deliveries.length === 0) {
        sheet.skippedRows.push({ row: r, reason: `«${name}»: нет количества и поставок` });
        issues.push({ level: "info", sheet: sheet.name, row: r, code: "ITEM_EMPTY", message: `Позиция «${name}» без количества и без поставок — не импортируется как заказ.` });
        continue;
      }
      if (qty === null) issues.push({ level: "error", sheet: sheet.name, row: r, code: "ITEM_NO_QTY", message: `«${name}»: есть поставки, но не указано заказанное количество.` });
      if (price === null) issues.push({ level: "warning", sheet: sheet.name, row: r, code: "ITEM_NO_PRICE", message: `«${name}»: не указана цена закупки — в средних ценах не учитывается.` });
      if (!orderDate) issues.push({ level: "warning", sheet: sheet.name, row: r, code: "ITEM_NO_DATE", message: `«${name}»: не указана дата заказа.` });
      for (const d of deliveries) {
        if (!d.date) issues.push({ level: "error", sheet: sheet.name, row: r, cell: d.cell, code: "DELIVERY_NO_DATE", message: `Поставка ${d.qty} в ${d.cell}: у столбца нет даты в строке ${dateRow}.` });
        if (d.qty < 0) issues.push({ level: "warning", sheet: sheet.name, row: r, cell: d.cell, code: "DELIVERY_NEGATIVE", message: `Отрицательная поставка ${d.qty} в ${d.cell} (возврат/корректировка?).` });
        if (d.fromFormula) issues.push({ level: "info", sheet: sheet.name, row: r, cell: d.cell, code: "DELIVERY_FORMULA", message: `Поставка в ${d.cell} задана формулой «=${d.fromFormula}», взято значение ${d.qty}.` });
      }
      const delivered = deliveries.reduce((s, d) => s + d.qty, 0);
      if (closedManually && qty !== null && delivered !== qty)
        issues.push({ level: "info", sheet: sheet.name, row: r, code: "REMAINDER_OVERRIDE", message: `«${name}»: «остаток неотгруженный» вручную заменён на ${toNum(remCell!.value)} (по факту ${+(qty - delivered).toFixed(3)}) — позиция будет помечена как закрытая.` });
      if (qty !== null && delivered > qty) {
        issues.push({ level: "warning", sheet: sheet.name, row: r, code: "OVER_DELIVERY", message: `«${name}»: поставлено ${delivered} при заказе ${qty} (+${+(delivered - qty).toFixed(3)}).` });
      }
      if (payAmount) {
        issues.push({ level: "warning", sheet: sheet.name, row: r, code: "PAYMENT_ON_ITEM", message: `Оплата ${payAmount} записана в строке товара — отнесена к счёту целиком.` });
        current.payments.push({ row: r, date: toDate(payDateRaw), amount: payAmount, doc: toStr(cellVal(ws, r, m.paymentDoc).value) ?? undefined });
      }
      current.items.push({ row: r, product: name, direction: direction ?? current.direction, qty, closedManually, price, amount, deliveries, note });
      continue;
    }

    if (isPayment) {
      const p: ParsedPayment = {
        row: r,
        date: toDate(payDateRaw),
        amount: payAmount!,
        doc: toStr(cellVal(ws, r, m.paymentDoc).value) ?? undefined,
        note,
      };
      if (!p.date) {
        const raw = toStr(payDateRaw);
        issues.push({ level: "warning", sheet: sheet.name, row: r, code: "PAYMENT_NO_DATE", message: `Оплата ${payAmount}: дата не распознана${raw ? ` («${raw}»)` : ""}.` });
      }
      // оплата относится к текущему счёту, если совпадает номер счёта (или он не указан)
      // иначе — ищем ранее открытый счёт с тем же номером (оплата записана после позиций соседнего счёта)
      const earlier = invoice ? [...sheet.orders].reverse().find((o) => o.invoice === invoice) : undefined;
      if (current && (!invoice || !current.invoice || invoice === current.invoice)) {
        current.payments.push(p);
        current.lastRow = r;
        seenPaymentInCurrent = true;
      } else if (earlier) {
        earlier.payments.push(p);
        issues.push({ level: "info", sheet: sheet.name, row: r, code: "PAYMENT_MATCHED_BY_INVOICE", message: `Оплата ${p.amount} стоит после позиций другого счёта — отнесена к счёту № ${invoice} по номеру.` });
        if (current) seenPaymentInCurrent = true;
      } else {
        // оплата вне счёта (например, блок авансов вверху листа «СозвездиеМЕЧТЫ»)
        sheet.supplierPayments.push({ ...p, supplier: supplierRaw ?? sheetSupplier, legalEntity: entityRaw });
      }
      continue;
    }

    // строка без товара и без оплаты: сальдо/служебная/пустая
    const hasValues = ws.getRow(r).actualCellCount > 0;
    if (hasValues) {
      const onlyFormulas = (() => {
        let any = false;
        let allF = true;
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
          const u = unwrap(cell.value);
          if ([m.direction, m.legalEntity, m.supplier, m.invoice].includes(c)) return;
          any = true;
          if (!u.formula) allF = false;
        });
        return any && allF;
      })();
      if (deliveries.length) {
        issues.push({ level: "warning", sheet: sheet.name, row: r, code: "DELIVERY_WITHOUT_ITEM", message: `Строка ${r}: есть количества в столбцах поставок, но нет наименования — пропущена (служебный расчёт?).` });
        sheet.skippedRows.push({ row: r, reason: "поставки без наименования (служебная строка)" });
      } else if (onlyFormulas) {
        sheet.skippedRows.push({ row: r, reason: "только формулы (сальдо/итоги)" });
      }
    }
  }
  close();

  // контрольные итоги Excel (строка «ИТОГО» — первая строка листа)
  const totalsRow = 1;
  sheet.excelTotals = {
    qty: toNum(cellVal(ws, totalsRow, m.qty).value) ?? undefined,
    amount: toNum(cellVal(ws, totalsRow, m.amount).value) ?? undefined,
    delivered: m.deliveryTo ? toNum(cellVal(ws, totalsRow, m.deliveryTo + 1).value) ?? undefined : undefined,
    paid: toNum(cellVal(ws, totalsRow, m.paymentAmount).value) ?? undefined,
  };
}

function parseSimple(ws: ExcelJS.Worksheet, sheet: ParsedSheet) {
  const m = sheet.mapping;
  const issues = sheet.issues;
  for (let r = sheet.headerRow + 1; r <= ws.rowCount; r++) {
    const supplier = entity(cellVal(ws, r, m.supplier).value);
    const amount = toNum(cellVal(ws, r, m.amount).value);
    if (!supplier && amount === null) {
      if (ws.getRow(r).actualCellCount > 0) sheet.skippedRows.push({ row: r, reason: "только формулы/пустая" });
      continue;
    }
    const note = toStr(cellVal(ws, r, m.note).value);
    const qtyCell = cellVal(ws, r, m.qty);
    const qty = toNum(qtyCell.value);
    const invoice = invoiceStr(cellVal(ws, r, m.invoice).value);
    const invoiceDate = toDate(cellVal(ws, r, m.invoiceDate).value);
    // в этом листе нет наименования товара — берём примечание или «Поставка по счёту №…»
    const product = note ?? `Товары/услуги по счёту № ${invoice ?? "б/н"}`;
    if (!note) issues.push({ level: "warning", sheet: sheet.name, row: r, code: "SIMPLE_NO_PRODUCT", message: `Нет наименования товара — будет создана позиция «${product}».` });
    const price = qty && amount ? +(amount / qty).toFixed(4) : null;
    const shipDate = toDate(cellVal(ws, r, m.shipDate).value);
    const shipAmountCell = cellVal(ws, r, m.shipAmount);
    const shipAmount = toNum(shipAmountCell.value);
    const shipQty = toNum(cellVal(ws, r, m.shipQty).value);
    const deliveries: ParsedDelivery[] = [];
    if (shipAmount || shipQty) {
      const dq = shipQty ?? (qty && shipAmount && amount ? +(qty * shipAmount / amount).toFixed(3) : null);
      if (!shipDate) issues.push({ level: "error", sheet: sheet.name, row: r, code: "SIMPLE_SHIP_NO_DATE", message: `Отгрузка на ${shipAmount ?? "?"} ₽ без даты поставки${shipAmountCell.formula ? ` (сумма задана формулой «=${shipAmountCell.formula}»)` : ""}. Дата будет взята из даты счёта — проверьте.` });
      if (dq === null) issues.push({ level: "warning", sheet: sheet.name, row: r, code: "SIMPLE_SHIP_NO_QTY", message: `Отгрузка на ${shipAmount} ₽ без количества и без количества заказа — будет учтена как 1 комплект.` });
      deliveries.push({ date: shipDate ?? invoiceDate, qty: dq ?? 1, cell: colLetter(m.shipAmount ?? 0) + r, fromFormula: shipAmountCell.formula });
    }
    const payments: ParsedPayment[] = [];
    const advAmount = toNum(cellVal(ws, r, m.advanceAmount).value);
    if (advAmount) {
      const d = toDate(cellVal(ws, r, m.advanceDate).value);
      if (!d) issues.push({ level: "warning", sheet: sheet.name, row: r, code: "PAYMENT_NO_DATE", message: `Аванс ${advAmount} без даты.` });
      payments.push({ row: r, date: d, amount: advAmount, doc: toStr(cellVal(ws, r, m.advanceDoc).value) ?? undefined, kind: "advance" });
    }
    const finAmount = toNum(cellVal(ws, r, m.finalAmount).value);
    if (finAmount) {
      payments.push({ row: r, date: toDate(cellVal(ws, r, m.finalDate).value), amount: finAmount, doc: toStr(cellVal(ws, r, m.finalDoc).value) ?? undefined, kind: "final" });
    }
    if (!supplier) issues.push({ level: "error", sheet: sheet.name, row: r, code: "NO_SUPPLIER", message: "Не указан контрагент." });
    sheet.orders.push({
      key: `${supplier}|${invoice}|${invoiceDate}|r${r}`,
      sheet: sheet.name,
      firstRow: r,
      lastRow: r,
      direction: toStr(cellVal(ws, r, m.direction).value),
      legalEntity: entity(cellVal(ws, r, m.legalEntity).value),
      supplier,
      invoice,
      orderDate: invoiceDate,
      note: note ?? undefined,
      items: [{ row: r, product, qty: qty ?? (deliveries.length ? deliveries[0].qty : 1), price: price ?? amount, amount, deliveries }],
      payments,
    });
  }
}

function parsePlan(ws: ExcelJS.Worksheet, sheet: ParsedSheet) {
  const m = sheet.mapping;
  const dates: { col: number; date: string }[] = [];
  if (m.dateFrom && m.dateTo) {
    for (let c = m.dateFrom; c <= m.dateTo; c++) {
      const d = toDate(cellVal(ws, sheet.headerRow, c).value);
      if (d) dates.push({ col: c, date: d });
    }
  }
  // примечание — первый текстовый столбец после дат с заполненными значениями
  let lastSupplier: string | null = null;
  for (let r = sheet.headerRow + 1; r <= ws.rowCount; r++) {
    const supplier: string | null = toStr(cellVal(ws, r, m.supplier).value) ?? lastSupplier;
    const product = toStr(cellVal(ws, r, m.product).value);
    if (!product) continue;
    lastSupplier = supplier;
    const weeks: { date: string; qty: number }[] = [];
    let status: string | null = null;
    const texts: string[] = [];
    for (const d of dates) {
      const v = cellVal(ws, r, d.col).value;
      const q = toNum(v);
      if (q !== null && q !== 0) weeks.push({ date: d.date, qty: q });
      else if (toStr(v)) {
        if (d.col === dates[0].col || weeks.length === 0) status = status ?? toStr(v);
        else texts.push(toStr(v)!);
      }
    }
    // в шаблоне примечание стоит в столбце R (внутри диапазона дат) — отделяем текст
    const note = texts.join("; ") || null;
    sheet.plan.push({ row: r, supplier: supplier ?? "", legalEntity: toStr(cellVal(ws, r, m.legalEntity).value), product, weeks, status, note });
  }
  sheet.issues.push({
    level: "warning",
    sheet: sheet.name,
    code: "PLAN_NOT_FACT",
    message: `Лист содержит понедельный график с ${dates[0]?.date ?? "?"} (шаг 7 дней), а не фактические поставки. Импортируется как «План поставок», в средние цены и задолженности не входит.`,
  });
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer, fileName: string, overrides?: Record<string, { kind?: SheetKind; mapping?: ColumnMapping; headerRow?: number }>): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs ждёт Buffer
  await wb.xlsx.load(buffer as ArrayBuffer);
  const sheets: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    const det = detectSheet(ws);
    const ov = overrides?.[ws.name];
    const kind = ov?.kind ?? det.kind;
    const headerRow = ov?.headerRow ?? det.headerRow;
    const sheet: ParsedSheet = {
      name: ws.name,
      kind,
      headerRow,
      mapping: { ...autoMapping(ws, kind, headerRow), ...(ov?.mapping ?? {}) },
      deliveryDates: [],
      orders: [],
      supplierPayments: [],
      plan: [],
      skippedRows: [],
      issues: [],
    };
    if (kind === "main") parseMain(ws, sheet);
    else if (kind === "simple") parseSimple(ws, sheet);
    else if (kind === "plan") parsePlan(ws, sheet);
    else sheet.issues.push({ level: "warning", sheet: ws.name, code: "UNKNOWN_SHEET", message: "Формат листа не распознан — лист пропущен." });
    sheets.push(sheet);
  }
  markDuplicateSheets(sheets);
  return { fileName, sheets };
}

// ---------- duplicates ----------

export function itemFingerprint(o: ParsedOrder, it: ParsedItem) {
  return [norm(o.supplier), norm(o.invoice), o.orderDate, norm(it.product), it.qty, it.price].join("|");
}

export interface SheetDuplicateInfo {
  sheet: string;
  duplicateOf: string;
  sameItems: number;
  totalItems: number;
  onlyInThis: string[];
  deliveryDiffs: number;
}

/** Лист считается копией другого, если ≥80% его позиций совпадают по отпечатку. */
export function markDuplicateSheets(sheets: ParsedSheet[]) {
  const fps = sheets.map((s) => new Set(s.orders.flatMap((o) => o.items.map((it) => itemFingerprint(o, it)))));
  for (let i = 0; i < sheets.length; i++) {
    for (let j = 0; j < sheets.length; j++) {
      if (i === j || fps[i].size === 0) continue;
      let same = 0;
      for (const f of fps[i]) if (fps[j].has(f)) same++;
      if (same / fps[i].size >= 0.8 && (fps[j].size > fps[i].size || (fps[j].size === fps[i].size && j < i) || /копия|copy/i.test(sheets[i].name))) {
        // в копии — более старое состояние: сравниваем поставки
        const delivJ = new Map<string, number>();
        for (const o of sheets[j].orders) for (const it of o.items) delivJ.set(itemFingerprint(o, it), it.deliveries.reduce((s, d) => s + d.qty, 0));
        let diffs = 0;
        const onlyHere: string[] = [];
        for (const o of sheets[i].orders)
          for (const it of o.items) {
            const f = itemFingerprint(o, it);
            if (!delivJ.has(f)) onlyHere.push(`стр. ${it.row}: ${it.product}`);
            else if (delivJ.get(f) !== it.deliveries.reduce((s, d) => s + d.qty, 0)) diffs++;
          }
        sheets[i].issues.unshift({
          level: "warning",
          sheet: sheets[i].name,
          code: "DUPLICATE_SHEET",
          message: `Лист — копия «${sheets[j].name}»: совпадает ${same} из ${fps[i].size} позиций, по ${diffs} позициям поставки отличаются (копия устарела), только здесь: ${onlyHere.length}. По умолчанию лист не импортируется.`,
        });
        (sheets[i] as ParsedSheet & { duplicateOf?: string; dupInfo?: SheetDuplicateInfo }).duplicateOf = sheets[j].name;
        (sheets[i] as ParsedSheet & { dupInfo?: SheetDuplicateInfo }).dupInfo = {
          sheet: sheets[i].name,
          duplicateOf: sheets[j].name,
          sameItems: same,
          totalItems: fps[i].size,
          onlyInThis: onlyHere,
          deliveryDiffs: diffs,
        };
        break;
      }
    }
  }
}
