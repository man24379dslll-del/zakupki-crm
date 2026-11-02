import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseWorkbook } from "../src/lib/import/parser";

const FILE = process.env.TEST_XLSX ?? "../src/orders.xlsx";

test("исходный Excel: итоги по листам совпадают с итоговыми строками файла", { skip: !existsSync(FILE) }, async () => {
  const r = await parseWorkbook(readFileSync(FILE), "x.xlsx");
  const by = Object.fromEntries(r.sheets.map((s) => [s.name, s]));
  for (const name of ["СозвездиеМЕЧТЫ", "Бьютирин-Новая линейка", "Юля-(ЛАКИ)", "МатериалБиоПро", "ООО Бьютирин"]) {
    const s = by[name];
    const amount = s.orders.flatMap((o) => o.items).reduce((a, i) => a + (i.qty ?? 0) * (i.price ?? 0), 0);
    const paid = s.orders.flatMap((o) => o.payments).reduce((a, p) => a + p.amount, 0);
    assert.ok(Math.abs(amount - s.excelTotals!.amount!) < 1, `${name}: сумма ${amount} vs ${s.excelTotals!.amount}`);
    assert.ok(Math.abs(paid - s.excelTotals!.paid!) < 1, `${name}: оплаты`);
  }
  // формула ИТОГО на «ООО Бьютирин» теряет столбцы — система считает все
  const b = by["ООО Бьютирин"];
  const del = b.orders.flatMap((o) => o.items).flatMap((i) => i.deliveries).reduce((a, d) => a + d.qty, 0);
  assert.equal(del, 832923);
  assert.ok(b.issues.some((i) => i.code === "EXCEL_TOTAL_RANGE"));
  // копия распознана, ПРИБОРЫ — план, ост.поставщики — строка = счёт
  assert.equal((by["ООО Бьютирин (копия)"] as { duplicateOf?: string }).duplicateOf, "ООО Бьютирин");
  assert.equal(by["ПРИБОРЫ"].kind, "plan");
  assert.equal(by["ост.поставщики"].kind, "simple");
  // строки итогов не стали заказами; блок авансов «СозвездиеМЕЧТЫ» — платежи без счёта
  assert.equal(by["СозвездиеМЕЧТЫ"].supplierPayments.length, 15);
  assert.ok(r.sheets.every((s) => s.orders.every((o) => o.firstRow > s.headerRow)));
});
