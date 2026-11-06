import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAct } from "../src/lib/recon";
import { numberInWords, rublesInWords } from "../src/lib/money-words";

test("сумма прописью — как в акте 1С", () => {
  assert.equal(rublesInWords(378852), "Триста семьдесят восемь тысяч восемьсот пятьдесят два рубля 00 копеек");
  assert.equal(rublesInWords(1001.5), "Одна тысяча один рубль 50 копеек");
  assert.equal(rublesInWords(2000000), "Два миллиона рублей 00 копеек");
  assert.equal(rublesInWords(21.01), "Двадцать один рубль 01 копейка");
  assert.equal(numberInWords(512), "пятьсот двенадцать");
  assert.equal(numberInWords(0), "ноль");
});

const line = (name: string, qty: number, price: number | null) => ({ name, unit: "шт", qty, price });

test("акт: сальдо на начало, обороты, сальдо на конец, товары", () => {
  const deliveries = [
    { id: "d0", date: "2024-12-20", waybill: "1", orderNo: "З-00001", lines: [line("Адмирал", 100, 10)] }, // до периода: +1 000
    { id: "d1", date: "2025-03-05", waybill: "312", orderNo: "З-00002", lines: [line("Адмирал", 1000, 128), line("Алтамакс", 10, null)] },
    { id: "d2", date: "2025-04-01", waybill: null, orderNo: "З-00003", lines: [line("Алтамакс", 100, 126)] },
    { id: "d3", date: "2026-01-01", waybill: "9", orderNo: "З-00004", lines: [line("Адмирал", 1, 1)] }, // после периода
  ];
  const payments = [
    { id: "p0", date: "2024-12-25", doc: "11", amount: 400, orderNo: "З-00001" }, // до периода: −400
    { id: "p1", date: "2025-03-05", doc: "223", amount: 100000, orderNo: null },
    { id: "p2", date: null, doc: null, amount: 5, orderNo: null },
  ];
  const a = buildAct(deliveries, payments, "2025-01-01", "2025-12-31");
  assert.equal(a.opening, 600, "сальдо на начало: поставлено 1 000 − оплачено 400");
  assert.equal(a.credit, 128000 + 12600, "поступления за период — без строки без цены");
  assert.equal(a.debit, 100000);
  assert.equal(a.closing, 600 + 140600 - 100000);
  assert.equal(a.rows.length, 3);
  assert.equal(a.rows[0].kind, "payment", "в один день оплата идёт раньше поставки");
  assert.equal(a.rows[0].title, "Оплата (п/п 223 от 05.03.2025), аванс без счёта");
  assert.equal(a.rows[1].title, "Поступление (УПД 312 от 05.03.2025), заказ З-00002");
  assert.equal(a.rows[1].unpriced, 1);
  assert.equal(a.rows[2].title, "Поступление от 01.04.2025, заказ З-00003");
  assert.equal(a.unpricedLines, 1);
  const b = buildAct([{ id: "x", date: "2025-02-02", waybill: "УПД 77", orderNo: "З-00009", lines: [] }], [{ id: "y", date: "2025-02-03", doc: null, amount: 1, orderNo: "З-00009" }], "2025-01-01", "2025-12-31");
  assert.equal(b.rows[0].title, "Поступление (УПД 77 от 02.02.2025), заказ З-00009", "«УПД» не повторяется");
  assert.equal(b.rows[1].title, "Оплата от 03.02.2025, заказ З-00009");
  assert.equal(a.undatedPayments, 1);
  assert.deepEqual(a.products.map((p) => [p.name, p.qty, p.sum, p.unpriced]), [["Адмирал", 1000, 128000, 0], ["Алтамакс", 110, 12600, 1]]);
});
