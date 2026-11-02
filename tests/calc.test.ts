import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOverDelivery, compareSuppliers, computeStatus, lastAndPrev, monthlySeries, priceWindow, weightedStats } from "../src/lib/calc";
import { normKey, isSimilar } from "../src/lib/normalize";

test("частичные поставки 300+400+300 из 1000 → 100% и статус «Поставлен полностью»", () => {
  const it = (d: number) => [{ id: "a", qty: 1000, delivered: d, isClosed: false }];
  assert.equal(computeStatus("SENT", it(0)), "SENT");
  assert.equal(computeStatus("AWAITING", it(300)), "PARTIAL");
  assert.equal(computeStatus("PARTIAL", it(700)), "PARTIAL");
  assert.equal(computeStatus("PARTIAL", it(1000)), "DELIVERED");
});
test("заказано 1000, поставлено 600 → частично поставлен", () => {
  assert.equal(computeStatus("CONFIRMED", [{ id: "a", qty: 1000, delivered: 600, isClosed: false }]), "PARTIAL");
});
test("закрытая позиция с недопоставкой считается выполненной; отменённый заказ не меняется", () => {
  assert.equal(computeStatus("PARTIAL", [{ id: "a", qty: 100, delivered: 50, isClosed: true }, { id: "b", qty: 10, delivered: 10, isClosed: false }]), "DELIVERED");
  assert.equal(computeStatus("CANCELLED", [{ id: "a", qty: 100, delivered: 100, isClosed: false }]), "CANCELLED");
});
test("удаление всех поставок возвращает статус «Ожидает поставки»", () => {
  assert.equal(computeStatus("PARTIAL", [{ id: "a", qty: 10, delivered: 0, isClosed: false }]), "AWAITING");
});
test("превышение заказанного количества без подтверждения обнаруживается", () => {
  const items = [{ id: "a", qty: 1000, delivered: 900, overDeliveryApproved: false }, { id: "b", qty: 5, delivered: 5, overDeliveryApproved: true }];
  assert.equal(checkOverDelivery(items, new Map([["a", 100]])).length, 0);
  assert.deepEqual(checkOverDelivery(items, new Map([["a", 101]])).map((x) => x.total), [1001]);
  assert.equal(checkOverDelivery(items, new Map([["b", 3]])).length, 0); // уже подтверждено руководителем
});
test("средневзвешенная цена = Σ(q·p)/Σq, без цены — не учитывается и не подменяется нулём", () => {
  const s = weightedStats([{ qty: 300, price: 120 }, { qty: 700, price: 110 }, { qty: 500, price: null }]);
  assert.equal(s.qty, 1000);
  assert.equal(s.avg, (300 * 120 + 700 * 110) / 1000);
  assert.equal(s.min, 110);
  assert.equal(s.max, 120);
  assert.equal(weightedStats([]).avg, null); // «Нет данных»
});
test("окно 6 месяцев: скользящее и календарное", () => {
  assert.deepEqual(priceWindow(6, "rolling", "2026-11-02"), { from: "2026-05-02", to: "2026-11-02" });
  assert.deepEqual(priceWindow(6, "calendar", "2026-11-02"), { from: "2026-05-01", to: "2026-10-31" });
  assert.deepEqual(priceWindow(6, "rolling", "2026-08-31"), { from: "2026-02-28", to: "2026-08-31" });
});
test("изменение цены к предыдущей закупке берётся по более ранней дате", () => {
  const r = lastAndPrev([{ date: "2026-01-10", price: 100 }, { date: "2026-02-10", price: 110 }, { date: "2026-02-10", price: 112 }]);
  assert.equal(r.lastPrice, 112);
  assert.equal(r.prevPrice, 100);
  assert.ok(Math.abs(r.change! - 12) < 1e-9);
});
test("сравнение поставщиков: дешевле первым, объём виден, разница с лучшей", () => {
  const p = (s: string, qty: number, price: number) => ({ date: "2026-10-01", qty, price, supplierId: s, supplierName: s, orderId: "o", orderNumber: 1 });
  const rows = compareSuppliers([p("A", 100, 120), p("B", 1000, 112), p("C", 50, 125)]);
  assert.deepEqual(rows.map((r) => r.supplierName), ["B", "A", "C"]);
  assert.equal(rows[0].qty, 1000);
  assert.ok(Math.abs(rows[1].diffFromBest! - (120 / 112 - 1) * 100) < 1e-9);
});
test("помесячный ряд содержит пустые месяцы как null", () => {
  const p = { qty: 10, price: 5, supplierId: "s", supplierName: "s", orderId: "o", orderNumber: 1 };
  const s = monthlySeries([{ ...p, date: "2026-09-05" }, { ...p, date: "2026-11-01", price: 7 }], 3, "2026-11-02");
  assert.deepEqual(s.map((x) => [x.month, x.avg]), [["2026-09", 5], ["2026-10", null], ["2026-11", 7]]);
});
test("нормализация названий для поиска дублей", () => {
  assert.equal(normKey("ИП ТЕСЛОВА ВАЛЕРИЯ ЮРЬЕВНА"), normKey("ИП Теслова  Валерия Юрьевна"));
  assert.equal(normKey("ПП - Поля"), normKey("ПП-поля"));
  assert.ok(isSimilar("ИП Елисеев Максим Анатольевич", "ИП Елисеев Максим Анатолиевич"));
  assert.ok(!isSimilar("Амокардин", "Адмирал"));
});
