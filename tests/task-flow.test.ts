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
