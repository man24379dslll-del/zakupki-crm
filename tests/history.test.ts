import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryHeadline, linesAmount, paymentHeadline } from "../src/lib/history";

const sp = (s: string) => s.replace(/ | /g, " ");

test("поставка одного товара — название и количество", () => {
  assert.equal(sp(deliveryHeadline("2026-11-05", [{ name: "Корвадинол", unit: "шт", qty: 420, price: 136 }])), "Поставка 05.11.2026: Корвадинол — 420 шт.");
});

test("поставка нескольких товаров — число товаров, количество и сумма", () => {
  const lines = [
    { name: "Диабирил", unit: "шт", qty: 1200, price: 150 },
    { name: "Корвадинол", unit: "шт", qty: 465, price: 136 },
    { name: "Остролекс", unit: "шт", qty: 420, price: null },
  ];
  assert.equal(sp(deliveryHeadline("2026-11-05", lines)), "Поставка 05.11.2026: 3 товара, 2 085 шт. на 243 240 ₽");
  assert.equal(linesAmount([{ qty: 5, price: null }]), null, "без цен сумма не считается (не ноль)");
  const five = Array.from({ length: 5 }, (_, i) => ({ name: `Т${i}`, unit: i ? "шт" : "кг", qty: 1, price: null }));
  assert.equal(deliveryHeadline("2026-11-05", five), "Поставка 05.11.2026: 5 товаров", "разные единицы не складываем");
});

test("оплата — дата, сумма, способ", () => {
  assert.equal(sp(paymentHeadline({ date: "2026-11-05", amount: 100000, method: "CASH" })), "Оплата 05.11.2026: 100 000 ₽, наличные");
  assert.equal(sp(paymentHeadline({ date: null, amount: 5000, method: "BANK" })), "Оплата 5 000 ₽, безнал");
});

test("сколько задача ждёт: часы и дни", async () => {
  const { fmtDuration } = await import("../src/lib/format");
  const now = Date.parse("2026-11-06T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3600e3).toISOString();
  assert.equal(fmtDuration(ago(0.5), now), "меньше часа");
  assert.equal(fmtDuration(ago(5), now), "5 ч");
  assert.equal(fmtDuration(ago(51), now), "2 дн. 3 ч");
  assert.equal(fmtDuration(ago(48), now), "2 дн.");
  assert.equal(fmtDuration(ago(24 * 12 + 5), now), "12 дн.");
});
