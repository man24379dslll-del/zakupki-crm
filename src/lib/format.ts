/** Форматирование чисел, денег и дат по-русски */
const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function fmtQty(v: unknown) {
  const n = num(v);
  return n === null ? "—" : nfq.format(n);
}
export function fmtMoney(v: unknown, digits: 0 | 2 = 0) {
  const n = num(v);
  if (n === null) return "—";
  return (digits === 2 ? nf2 : nf0).format(n) + " ₽";
}
export function fmtPrice(v: unknown) {
  const n = num(v);
  if (n === null) return "—";
  return nf2.format(n) + " ₽";
}
export function fmtPct(v: number | null) {
  return v === null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`;
}
export function fmtDate(v: unknown) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? v + "T00:00:00" : v) : (v as Date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function fmtDateTime(v: unknown) {
  if (!v) return "—";
  const d = new Date(v as string);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
/** Сколько прошло: «меньше часа», «5 ч», «2 дн. 3 ч», «12 дн.» (для «сколько задача ждёт») */
export function fmtDuration(from: unknown, now: number = Date.now()) {
  if (!from) return "—";
  const ms = now - new Date(from as string).getTime();
  if (!Number.isFinite(ms) || ms < 3600e3) return "меньше часа";
  const h = Math.floor(ms / 3600e3);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return d >= 7 || h % 24 === 0 ? `${d} дн.` : `${d} дн. ${h % 24} ч`;
}
export const orderNo = (n: number) => `З-${String(n).padStart(5, "0")}`;

/** Сегодня в формате YYYY-MM-DD (часовой пояс сервера/компании) */
export function today(): string {
  const tz = process.env.TZ_COMPANY ?? "Europe/Moscow";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());
}
export function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  SENT: "Отправлен поставщику",
  CONFIRMED: "Подтверждён поставщиком",
  AWAITING: "Ожидает поставки",
  PARTIAL: "Частично поставлен",
  DELIVERED: "Поставлен полностью",
  CANCELLED: "Отменён",
};
export const ORDER_STATUS_TONE: Record<string, string> = {
  DRAFT: "gray",
  SENT: "blue",
  CONFIRMED: "blue",
  AWAITING: "amber",
  PARTIAL: "violet",
  DELIVERED: "green",
  CANCELLED: "red",
};
export const TASK_STATUS_LABEL: Record<string, string> = { NEW: "Новая", IN_PROGRESS: "В работе", WAITING: "Ожидает ответа", REVIEW: "На согласовании", DONE: "Выполнена", CANCELLED: "Отменена" };
export const TASK_STATUS_TONE: Record<string, string> = { NEW: "blue", IN_PROGRESS: "violet", WAITING: "amber", REVIEW: "cyan", DONE: "green", CANCELLED: "gray" };
export const PRIORITY_LABEL: Record<string, string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", URGENT: "Срочный" };
export const PRIORITY_TONE: Record<string, string> = { LOW: "gray", NORMAL: "blue", HIGH: "amber", URGENT: "red" };
export const PAYMENT_TYPE_LABEL: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Частичная", FULL: "Полная" };
export const PAYMENT_METHOD_LABEL: Record<string, string> = { BANK: "Безнал", CASH: "Наличные" };
/** Способ оплаты заказа (комплексная — часть наличными, часть безналом) */
export const ORDER_PAY_LABEL: Record<string, string> = { BANK: "Безнал", CASH: "Наличные", MIXED: "Комплексная (нал + безнал)" };
export const SUPPLIER_STATUS_LABEL: Record<string, string> = { NEGOTIATION: "Переговоры", ACTIVE: "Работаем", PAUSED: "Приостановлено", STOPPED: "Прекращено" };
export const SUPPLIER_STATUS_TONE: Record<string, string> = { NEGOTIATION: "blue", ACTIVE: "green", PAUSED: "amber", STOPPED: "gray" };
export const ROLE_LABEL: Record<string, string> = { ADMIN: "Руководитель", BUYER: "Закупщик", VIEWER: "Наблюдатель" };
