/**
 * Схема БД CRM закупок (PostgreSQL, Drizzle ORM).
 * Деньги — numeric(16,2), цены — numeric(16,4), количества — numeric(16,3).
 * Важные сущности удаляются мягко (deleted_at); физическое удаление — только администратором.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const qty = (n: string) => numeric(n, { precision: 16, scale: 3 });
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });
const priceCol = (n: string) => numeric(n, { precision: 16, scale: 4 });

// ---------- enums ----------
export const roleCode = pgEnum("role_code", ["ADMIN", "BUYER", "VIEWER"]);
export const supplierStatus = pgEnum("supplier_status", ["NEGOTIATION", "ACTIVE", "PAUSED", "STOPPED"]);
export const orderStatus = pgEnum("order_status", ["DRAFT", "SENT", "CONFIRMED", "AWAITING", "PARTIAL", "DELIVERED", "CANCELLED"]);
export const paymentType = pgEnum("payment_type", ["ADVANCE", "PARTIAL", "FULL"]);
export const paymentMethod = pgEnum("payment_method", ["BANK", "CASH"]);
/// как платим по заказу: безнал, наличные или комплексно (часть нал, часть безнал)
export const orderPayMethod = pgEnum("order_pay_method", ["BANK", "CASH", "MIXED"]);
export const taskPriority = pgEnum("task_priority", ["LOW", "NORMAL", "HIGH", "URGENT"]);
export const taskStatus = pgEnum("task_status", ["NEW", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"]);

// ---------- пользователи и доступ ----------
export const roles = pgTable("roles", {
  id: id(),
  code: roleCode("code").notNull().unique(),
  name: text("name").notNull(),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
});

export const users = pgTable("users", {
  id: id(),
  login: text("login").notNull().unique(),
  email: text("email"),
  name: text("name").notNull(),
  phone: text("phone"),
  position: text("position"),
  passwordHash: text("password_hash").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  /// дополнительные права, выданные руководителем (orders.viewAll, stats.viewAll …)
  extraPermissions: text("extra_permissions").array().notNull().default(sql`'{}'::text[]`),
  /// права роли, которые у этого сотрудника сняты (можно ограничить и руководителя)
  revokedPermissions: text("revoked_permissions").array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  /// удалён из списка сотрудников (только заблокированный); имя остаётся в заказах и истории, восстановление — Настройки → Удалённые
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: created(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 токена
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: created(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------- справочники ----------
export const legalEntities = pgTable("legal_entities", {
  id: id(),
  name: text("name").notNull(),
  /// как юрлицо называют в отделе («Добрынин»); в списках показывается оно, полное — в подсказке
  shortName: text("short_name"),
  key: text("key").notNull().unique(),
  inn: text("inn"),
  isActive: boolean("is_active").notNull().default(true),
});

export const directions = pgTable("directions", {
  id: id(),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
});

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  legalName: text("legal_name"),
  inn: text("inn"),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  bankDetails: text("bank_details"),
  activity: text("activity"),
  comment: text("comment"),
  status: supplierStatus("status").notNull().default("ACTIVE"),
  startedAt: date("started_at"),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const supplierBuyers = pgTable(
  "supplier_buyers",
  {
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.userId] })],
);

/// Договоры с поставщиком: история сохраняется, актуальный — последний по дате. Файлы — documents с entity_type = 'contract'
export const supplierContracts = pgTable(
  "supplier_contracts",
  {
    id: id(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    number: text("number"),
    date: date("date"),
    /// null = бессрочный
    validUntil: date("valid_until"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: created(),
    /// когда напомнили об окончании (чтобы не повторять)
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("contracts_supplier_idx").on(t.supplierId)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    sku: text("sku"),
    category: text("category"),
    unit: text("unit").notNull().default("шт"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_key_idx").on(t.key)],
);

export const productSuppliers = pgTable(
  "product_suppliers",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    isMain: boolean("is_main").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.productId, t.supplierId] })],
);

// ---------- импорт ----------
export const importBatches = pgTable("import_batches", {
  id: id(),
  fileName: text("file_name").notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: created(),
  status: text("status").notNull(), // preview | done | failed | rolled_back
  settings: jsonb("settings"),
  summary: jsonb("summary"),
});

// ---------- заказы ----------
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    number: serial("number").notNull().unique(),
    orderDate: date("order_date").notNull(),
    buyerId: uuid("buyer_id").references(() => users.id),
    createdById: uuid("created_by_id").references(() => users.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id),
    directionId: uuid("direction_id").references(() => directions.id),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date"),
    plannedDeliveryDate: date("planned_delivery_date"),
    /// способ оплаты; null — не указан
    paymentMethod: orderPayMethod("payment_method"),
    /// для комплексной оплаты: сколько из суммы заказа платим наличными (остальное безнал)
    cashPlanned: money("cash_planned"),
    status: orderStatus("status").notNull().default("DRAFT"),
    comment: text("comment"),
    source: text("source"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("po_supplier_idx").on(t.supplierId),
    index("po_buyer_idx").on(t.buyerId),
    index("po_status_idx").on(t.status),
    index("po_date_idx").on(t.orderDate),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    directionId: uuid("direction_id").references(() => directions.id),
    qty: qty("qty").notNull(),
    /// null = цена не указана (не подменяется нулём)
    price: priceCol("price"),
    /// свой срок поставки позиции; null = как у заказа (purchase_orders.planned_delivery_date)
    plannedDeliveryDate: date("planned_delivery_date"),
    /// позиция закрыта: недопоставленный остаток больше не ожидается
    isClosed: boolean("is_closed").notNull().default(false),
    closedNote: text("closed_note"),
    /// превышение количества подтверждено руководителем (или пришло из Excel)
    overDeliveryApproved: boolean("over_delivery_approved").notNull().default(false),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("poi_order_idx").on(t.orderId), index("poi_product_idx").on(t.productId)],
);

// ---------- поставки ----------
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => purchaseOrders.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    date: date("date").notNull(),
    /// дата в источнике не указана и подставлена
    dateAssumed: boolean("date_assumed").notNull().default(false),
    waybillNumber: text("waybill_number"),
    comment: text("comment"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: created(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("del_order_idx").on(t.orderId), index("del_date_idx").on(t.date)],
);

export const deliveryItems = pgTable(
  "delivery_items",
  {
    id: id(),
    deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id").notNull().references(() => purchaseOrderItems.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    qty: qty("qty").notNull(),
    /// фактическая цена за единицу; null = не указана
    price: priceCol("price"),
    /// не учитывать в средних ценах (условное количество «1 комплект»)
    excludeFromPrice: boolean("exclude_from_price").notNull().default(false),
    sourceCell: text("source_cell"),
  },
  (t) => [index("di_product_idx").on(t.productId), index("di_order_item_idx").on(t.orderItemId)],
);

// ---------- оплаты ----------
export const payments = pgTable(
  "payments",
  {
    id: id(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    /// null = аванс поставщику без привязки к счёту
    orderId: uuid("order_id").references(() => purchaseOrders.id),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id),
    type: paymentType("type").notNull().default("PARTIAL"),
    method: paymentMethod("method").notNull().default("BANK"),
    date: date("date"),
    amount: money("amount").notNull(),
    docNumber: text("doc_number"),
    comment: text("comment"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: created(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("pay_supplier_idx").on(t.supplierId), index("pay_order_idx").on(t.orderId)],
);

// ---------- задачи ----------
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").notNull().references(() => users.id),
    creatorId: uuid("creator_id").notNull().references(() => users.id),
    createdAt: created(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    priority: taskPriority("priority").notNull().default("NORMAL"),
    status: taskStatus("status").notNull().default("NEW"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    orderId: uuid("order_id").references(() => purchaseOrders.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("task_assignee_idx").on(t.assigneeId, t.status)],
);

export const taskComments = pgTable("task_comments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  text: text("text").notNull(),
  createdAt: created(),
});

// ---------- общее ----------
export const comments = pgTable(
  "comments",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    text: text("text").notNull(),
    createdAt: created(),
  },
  (t) => [index("comments_entity_idx").on(t.entityType, t.entityId)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    entityType: text("entity_type").notNull(), // supplier | order | delivery | payment | task
    entityId: uuid("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storagePath: text("storage_path").notNull(),
    uploadedById: uuid("uploaded_by_id").notNull().references(() => users.id),
    createdAt: created(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("docs_entity_idx").on(t.entityType, t.entityId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    createdAt: created(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notif_user_idx").on(t.userId, t.readAt)],
);

/// Журнал действий: кто, что, когда, какие поля и значения до/после
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    /// { поле: [было, стало] }
    changes: jsonb("changes"),
    createdAt: created(),
    ip: text("ip"),
  },
  (t) => [
    index("log_entity_idx").on(t.entityType, t.entityId),
    index("log_user_idx").on(t.userId, t.createdAt),
    index("log_created_idx").on(t.createdAt),
  ],
);

/// План поставок (лист «ПРИБОРЫ»): понедельные количества, не факт
export const supplyPlanEntries = pgTable(
  "supply_plan_entries",
  {
    id: id(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id),
    weekStart: date("week_start"),
    qty: qty("qty"),
    status: text("status"),
    note: text("note"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
  },
  (t) => [index("plan_supplier_idx").on(t.supplierId), index("plan_product_idx").on(t.productId)],
);

export const savedViews = pgTable("saved_views", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  page: text("page").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: created(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// ---------- relations ----------
export const usersRelations = relations(users, ({ one }) => ({ role: one(roles, { fields: [users.roleId], references: [roles.id] }) }));
export const supplierRelations = relations(suppliers, ({ many }) => ({ buyers: many(supplierBuyers), orders: many(purchaseOrders), products: many(productSuppliers) }));
export const supplierBuyersRelations = relations(supplierBuyers, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierBuyers.supplierId], references: [suppliers.id] }),
  user: one(users, { fields: [supplierBuyers.userId], references: [users.id] }),
}));
export const productSuppliersRelations = relations(productSuppliers, ({ one }) => ({
  supplier: one(suppliers, { fields: [productSuppliers.supplierId], references: [suppliers.id] }),
  product: one(products, { fields: [productSuppliers.productId], references: [products.id] }),
}));
export const orderRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  buyer: one(users, { fields: [purchaseOrders.buyerId], references: [users.id] }),
  legalEntity: one(legalEntities, { fields: [purchaseOrders.legalEntityId], references: [legalEntities.id] }),
  direction: one(directions, { fields: [purchaseOrders.directionId], references: [directions.id] }),
  items: many(purchaseOrderItems),
  deliveries: many(deliveries),
  payments: many(payments),
}));
export const orderItemRelations = relations(purchaseOrderItems, ({ one, many }) => ({
  order: one(purchaseOrders, { fields: [purchaseOrderItems.orderId], references: [purchaseOrders.id] }),
  product: one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
  direction: one(directions, { fields: [purchaseOrderItems.directionId], references: [directions.id] }),
  deliveryItems: many(deliveryItems),
}));
export const deliveryRelations = relations(deliveries, ({ one, many }) => ({
  order: one(purchaseOrders, { fields: [deliveries.orderId], references: [purchaseOrders.id] }),
  supplier: one(suppliers, { fields: [deliveries.supplierId], references: [suppliers.id] }),
  createdBy: one(users, { fields: [deliveries.createdById], references: [users.id] }),
  items: many(deliveryItems),
}));
export const deliveryItemRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryItems.deliveryId], references: [deliveries.id] }),
  orderItem: one(purchaseOrderItems, { fields: [deliveryItems.orderItemId], references: [purchaseOrderItems.id] }),
  product: one(products, { fields: [deliveryItems.productId], references: [products.id] }),
}));
export const paymentRelations = relations(payments, ({ one }) => ({
  order: one(purchaseOrders, { fields: [payments.orderId], references: [purchaseOrders.id] }),
  supplier: one(suppliers, { fields: [payments.supplierId], references: [suppliers.id] }),
  createdBy: one(users, { fields: [payments.createdById], references: [users.id] }),
}));
export const taskRelations = relations(tasks, ({ one, many }) => ({
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id], relationName: "assignee" }),
  creator: one(users, { fields: [tasks.creatorId], references: [users.id], relationName: "creator" }),
  supplier: one(suppliers, { fields: [tasks.supplierId], references: [suppliers.id] }),
  order: one(purchaseOrders, { fields: [tasks.orderId], references: [purchaseOrders.id] }),
  comments: many(taskComments),
}));
export const taskCommentRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [taskComments.authorId], references: [users.id] }),
}));
export const activityRelations = relations(activityLogs, ({ one }) => ({ user: one(users, { fields: [activityLogs.userId], references: [users.id] }) }));

void uniqueIndex;
