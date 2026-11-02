/**
 * Права доступа. Роль даёт набор прав по умолчанию; руководитель может выдать сотруднику дополнительные права.
 * Все проверки выполняются на сервере (requirePerm / scope-фильтры в запросах).
 */
export const PERMS = {
  ordersViewAll: "orders.viewAll", // видеть заказы всех закупщиков
  ordersEdit: "orders.edit", // создавать и менять заказы, поставки, оплаты
  ordersCancel: "orders.cancel",
  overDeliveryApprove: "orders.overDeliveryApprove", // подтверждать превышение количества
  suppliersEdit: "suppliers.edit",
  productsEdit: "products.edit",
  productsMerge: "products.merge",
  tasksAssign: "tasks.assign", // ставить задачи другим
  tasksViewAll: "tasks.viewAll",
  statsViewAll: "stats.viewAll", // аналитика по всему отделу и чужие показатели
  usersManage: "users.manage",
  auditView: "audit.view",
  importRun: "import.run",
  deleteRecords: "records.delete",
  settingsEdit: "settings.edit",
} as const;

export type Perm = (typeof PERMS)[keyof typeof PERMS];

export const PERM_LABELS: Record<Perm, string> = {
  "orders.viewAll": "Видеть заказы всех закупщиков",
  "orders.edit": "Создавать и изменять заказы, поставки, оплаты",
  "orders.cancel": "Отменять заказы",
  "orders.overDeliveryApprove": "Подтверждать поставку сверх заказа",
  "suppliers.edit": "Изменять поставщиков",
  "products.edit": "Изменять товары",
  "products.merge": "Объединять дубли товаров",
  "tasks.assign": "Ставить задачи сотрудникам",
  "tasks.viewAll": "Видеть все задачи",
  "stats.viewAll": "Видеть аналитику всего отдела",
  "users.manage": "Управлять пользователями",
  "audit.view": "Смотреть журнал действий",
  "import.run": "Импортировать Excel",
  "records.delete": "Удалять записи",
  "settings.edit": "Менять настройки",
};

const ALL = Object.values(PERMS) as Perm[];

export const ROLE_DEFAULTS: Record<"ADMIN" | "BUYER" | "VIEWER", { name: string; perms: Perm[] }> = {
  ADMIN: { name: "Администратор / Руководитель", perms: ALL },
  BUYER: { name: "Закупщик", perms: [PERMS.ordersEdit, PERMS.suppliersEdit, PERMS.productsEdit] },
  VIEWER: { name: "Наблюдатель", perms: [] },
};

/** Права, которые руководитель может выдать закупщику/наблюдателю дополнительно */
export const GRANTABLE: Perm[] = [PERMS.ordersViewAll, PERMS.statsViewAll, PERMS.tasksViewAll, PERMS.tasksAssign, PERMS.ordersCancel, PERMS.productsMerge, PERMS.auditView];

export interface SessionUser {
  id: string;
  name: string;
  login: string;
  role: "ADMIN" | "BUYER" | "VIEWER";
  perms: Set<string>;
}

export function can(u: SessionUser | null | undefined, p: Perm): boolean {
  return !!u && u.perms.has(p);
}
