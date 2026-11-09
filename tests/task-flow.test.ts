import { test } from "node:test";
import assert from "node:assert/strict";
import { stepTarget, taskSteps, type FlowTask } from "../src/lib/task-flow";

const boss = { id: "boss", canAssign: true };
const buyer = { id: "buyer", canAssign: false };
const other = { id: "other", canAssign: false };
const task = (status: FlowTask["status"], o: Partial<FlowTask> = {}): FlowTask => ({ status, assigneeId: "buyer", creatorId: "boss", creatorActive: true, ...o });

test("задача от руководителя: исполнитель берёт в работу и отправляет на согласование", () => {
  assert.deepEqual(taskSteps(task("NEW"), buyer), ["start"]);
  assert.deepEqual(taskSteps(task("IN_PROGRESS"), buyer), ["submit", "wait"]);
  assert.deepEqual(taskSteps(task("WAITING"), buyer), ["submit", "resume"]);
  assert.deepEqual(taskSteps(task("REVIEW"), buyer), [], "на согласовании исполнитель ждёт");
  assert.deepEqual(taskSteps(task("DONE"), buyer), []);
  assert.ok(!taskSteps(task("IN_PROGRESS"), buyer).includes("done"), "сам отметить «Выполнена» не может");
});

test("постановщик согласует или возвращает, отменяет и открывает заново", () => {
  assert.deepEqual(taskSteps(task("NEW"), boss), ["cancel"]);
  assert.deepEqual(taskSteps(task("REVIEW"), boss), ["approve", "return", "cancel"]);
  assert.deepEqual(taskSteps(task("DONE"), boss), ["reopen"]);
  assert.equal(stepTarget("approve", "REVIEW"), "DONE");
  assert.equal(stepTarget("return", "REVIEW"), "IN_PROGRESS");
  assert.equal(stepTarget("reopen", "CANCELLED"), "NEW");
  assert.equal(stepTarget("reopen", "DONE"), "IN_PROGRESS");
});

test("согласует только постановщик; другой руководитель — лишь если постановщика нет в программе", () => {
  const byBuyer2 = task("REVIEW", { creatorId: "other", assigneeId: "buyer" });
  assert.deepEqual(taskSteps(byBuyer2, boss), ["cancel"], "чужую задачу руководитель не согласует");
  assert.deepEqual(taskSteps({ ...byBuyer2, creatorActive: false }, boss), ["approve", "return", "cancel"]);
  assert.deepEqual(taskSteps(byBuyer2, other), ["approve", "return", "cancel"],"постановщик без права ставить задачи всё равно согласует и отменяет");
});

test("задача самому себе — без согласования", () => {
  const self = task("NEW", { creatorId: "buyer" });
  assert.deepEqual(taskSteps(self, buyer), ["start", "done", "cancel"]);
  assert.deepEqual(taskSteps({ ...self, status: "IN_PROGRESS" }, buyer), ["done", "wait", "cancel"]);
  assert.ok(!taskSteps({ ...self, status: "IN_PROGRESS" }, buyer).includes("submit"));
});

test("посторонний сотрудник кнопок не видит", () => {
  for (const s of ["NEW", "IN_PROGRESS", "REVIEW", "DONE"] as const) assert.deepEqual(taskSteps(task(s), other), []);
});

test("задача «Закупка»: привязать можно только заказ, оформленный после постановки задачи", async () => {
  const { linkError } = await import("../src/lib/purchase");
  const task = { day: "2026-11-05", createdAt: Date.parse("2026-11-05T09:00:00Z") };
  const ok = { orderDate: "2026-11-05", createdAt: Date.parse("2026-11-05T10:00:00Z"), status: "SENT", deleted: false };
  assert.equal(linkError(task, ok), null);
  assert.match(linkError(task, { ...ok, orderDate: "2026-11-04" }) ?? "", /раньше даты задачи 05\.11\.2026/);
  assert.match(linkError(task, { ...ok, createdAt: Date.parse("2026-11-01T10:00:00Z") }) ?? "", /создан/, "старый заказ с исправленной датой не проходит");
  assert.match(linkError(task, { ...ok, status: "CANCELLED" }) ?? "", /отменён/);
});

test("задача «Закупка»: выполнение по нескольким заказам", async () => {
  const { purchaseCoverage } = await import("../src/lib/purchase");
  const items = [
    { productId: "a", name: "Адмирал", unit: "шт", qty: 10000, targetPrice: 125 },
    { productId: "b", name: "Алтамакс", unit: "шт", qty: 500, targetPrice: null },
  ];
  const lines = [
    { productId: "a", name: "Адмирал", unit: "шт", qty: 6000, price: 128 },
    { productId: "a", name: "Адмирал", unit: "шт", qty: 2000, price: 120 },
    { productId: "c", name: "Мозгофлекс", unit: "шт", qty: 50, price: 95 },
  ];
  const c = purchaseCoverage(items, lines);
  assert.deepEqual(c.rows.map((r) => [r.name, r.ordered, r.rest, r.avgPrice]), [["Адмирал", 8000, 2000, 126], ["Алтамакс", 0, 500, null]]);
  assert.equal(c.short, true);
  assert.equal(c.overTarget, true, "126 > ориентира 125");
  assert.deepEqual(c.extra, [{ productId: "c", name: "Мозгофлекс", unit: "шт", qty: 50 }], "товар не из задачи — отдельно");
  assert.equal(c.complete, false);
  assert.equal(purchaseCoverage(items.slice(0, 1), [{ productId: "a", name: "Адмирал", unit: "шт", qty: 10000, price: 120 }]).complete, true);
});

test("инструкция: разделы по правам", async () => {
  const { visibleHelp, HELP } = await import("../src/lib/help");
  const { ROLE_DEFAULTS } = await import("../src/lib/permissions");
  const ids = (role: "ADMIN" | "BUYER" | "VIEWER", perms = ROLE_DEFAULTS[role].perms as string[]) => visibleHelp(new Set(perms), role).map((s) => s.id);
  assert.equal(ids("ADMIN").length, HELP.length, "руководитель видит всё");
  const buyer = ids("BUYER");
  for (const id of ["start", "order-new", "delivery", "payment-new", "tasks", "purchase-tasks", "recon-act"]) assert.ok(buyer.includes(id), `закупщик видит «${id}»`);
  for (const id of ["users", "analytics", "audit", "import", "tasks-assign", "deleted"]) assert.ok(!buyer.includes(id), `закупщик не видит «${id}»`);
  const viewer = ids("VIEWER");
  for (const id of ["order-new", "delivery", "tasks", "purchase-tasks", "payment-new"]) assert.ok(!viewer.includes(id), `наблюдатель не видит «${id}»`);
  assert.ok(viewer.includes("orders") && viewer.includes("recon-act"));
  assert.ok(ids("BUYER", [...ROLE_DEFAULTS.BUYER.perms, "stats.viewAll"]).includes("analytics"), "выдали право — появился раздел");
  for (const s of HELP) for (const b of s.body) if (typeof b === "object" && "img" in b) assert.match(b.img, /^[a-z-]+$/);
});
