"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, requirePerm, requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { diff, logActivity, notify } from "@/lib/audit";
import { fdate, fnum, fstr, safe, UserError } from "@/lib/forms";
import { ensureProduct, findProductExact, linkProductSupplier, similarProducts } from "@/lib/services/refs";
import { isSimilar, normKey } from "@/lib/normalize";
import { assertOrderAccess, checkOverDelivery, itemProgress, recalcOrderStatus } from "@/lib/services/orders";
import { ORDER_STATUS_LABEL, orderNo, today } from "@/lib/format";
import type { ActionResult } from "@/components/client";

type Status = (typeof schema.orderStatus.enumValues)[number];

function readItems(fd: FormData) {
  const names = fd.getAll("item_product").map((v) => String(v).trim());
  const qtys = fd.getAll("item_qty");
  const prices = fd.getAll("item_price");
  const dirs = fd.getAll("item_direction");
  const dues = fd.getAll("item_due");
  const out: { name: string; qty: number; price: number | null; directionId: string | null; due: string | null }[] = [];
  names.forEach((name, i) => {
    const q = fnum(qtys[i]);
    const p = fnum(prices[i]);
    if (!name && q === null && p === null) return; // пустая строка
    if (!name) throw new UserError(`Строка ${i + 1}: укажите товар`);
    if (q === null || Number.isNaN(q) || q <= 0) throw new UserError(`«${name}»: количество должно быть больше нуля`);
    if (p !== null && (Number.isNaN(p) || p < 0)) throw new UserError(`«${name}»: неверная цена`);
    if (fstr(dues[i]) && !fdate(dues[i])) throw new UserError(`«${name}»: неверный срок поставки`);
    out.push({ name, qty: q, price: p, directionId: fstr(dirs[i]), due: fdate(dues[i]) });
  });
  return out;
}

export async function createOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let newId = "";
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.ordersEdit);
    let supplierId = fstr(fd.get("supplierId"));
    if (!supplierId) throw new UserError("Выберите поставщика");
    // «+ Добавить поставщика» из списка: создаём с одним названием, реквизиты — потом в карточке
    const newSupplier = supplierId.startsWith("new:") ? supplierId.slice(4).trim() : null;
    if (newSupplier !== null) {
      if (!newSupplier) throw new UserError("Укажите название поставщика");
      if (!can(u, PERMS.suppliersEdit)) throw new UserError("Нет права добавлять поставщиков — выберите из списка");
      const [ex] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.key, normKey(newSupplier)), isNull(schema.suppliers.deletedAt)));
      if (ex) supplierId = ex.id;
      else if (!fd.get("confirm")) {
        const all = await db.select({ name: schema.suppliers.name }).from(schema.suppliers).where(isNull(schema.suppliers.deletedAt));
        const sim = all.filter((s) => isSimilar(s.name, newSupplier)).slice(0, 3);
        if (sim.length) return { needConfirm: `Поставщик «${newSupplier}» похож на ${sim.map((s) => `«${s.name}»`).join(", ")}. Создать нового поставщика? Если это он же — выберите его из списка.` };
      }
    }
    const orderDate = fdate(fd.get("orderDate")) ?? today();
    const items = readItems(fd);
    if (!items.length) throw new UserError("Добавьте хотя бы один товар");
    // назначить другого закупщика может только тот, кто видит все заказы
    const buyerId = can(u, PERMS.ordersViewAll) ? fstr(fd.get("buyerId")) ?? u.id : u.id;

    // защита от дублей товаров: новое название похоже на существующее → спросить
    if (!fd.get("confirm")) {
      const hints: string[] = [];
      for (const it of items) {
        if (await findProductExact(db, it.name)) continue;
        const sim = await similarProducts(it.name, 3);
        if (sim.length) hints.push(`«${it.name}» — похоже на: ${sim.map((s) => `«${s.name}»`).join(", ")}`);
      }
      if (hints.length) return { needConfirm: `Возможно, такие товары уже есть в справочнике. ${hints.join("; ")}. Выберите существующий из списка или подтвердите создание нового товара.` };
    }

    await db.transaction(async (tx) => {
      if (supplierId!.startsWith("new:")) {
        const name = supplierId!.slice(4).trim();
        const [s] = await tx.insert(schema.suppliers).values({ name, key: normKey(name) }).returning();
        await tx.insert(schema.supplierBuyers).values({ supplierId: s.id, userId: buyerId ?? u.id, isPrimary: true }).onConflictDoNothing();
        await logActivity(tx, { userId: u.id, action: "create", entityType: "supplier", entityId: s.id, summary: `Создан поставщик «${name}» (из формы заказа)` });
        supplierId = s.id;
      }
      const [o] = await tx
        .insert(schema.purchaseOrders)
        .values({
          orderDate,
          buyerId,
          createdById: u.id,
          supplierId: supplierId!,
          legalEntityId: fstr(fd.get("legalEntityId")),
          directionId: fstr(fd.get("directionId")),
          invoiceNumber: fstr(fd.get("invoiceNumber")),
          invoiceDate: fdate(fd.get("invoiceDate")),
          plannedDeliveryDate: fdate(fd.get("plannedDeliveryDate")),
          status: (fstr(fd.get("status")) as Status) ?? "DRAFT",
          comment: fstr(fd.get("comment")),
          source: "manual",
        })
        .returning();
      newId = o.id;
      let i = 0;
      for (const it of items) {
        const p = await ensureProduct(tx, it.name);
        await linkProductSupplier(tx, p.id, supplierId!);
        await tx.insert(schema.purchaseOrderItems).values({ orderId: o.id, productId: p.id, directionId: it.directionId, plannedDeliveryDate: it.due, qty: String(it.qty), price: it.price === null ? null : String(it.price), sortOrder: i++ });
      }
      const sum = items.reduce((s, x) => s + x.qty * (x.price ?? 0), 0);
      await logActivity(tx, { userId: u.id, action: "create", entityType: "order", entityId: o.id, summary: `Создан заказ ${orderNo(o.number)} на ${sum.toLocaleString("ru-RU")} ₽ (${items.length} поз.)`, ip: await clientIp() });
      if (buyerId && buyerId !== u.id) await notify(tx, { userId: buyerId, type: "order_assigned", title: `Вам назначен заказ ${orderNo(o.number)}`, link: `/orders/${o.id}` });
    });
  });
  if (r && "error" in r) return r;
  if (r && "needConfirm" in r) return r;
  redirect(`/orders/${newId}`);
}

export async function updateOrderHeaderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const id = String(fd.get("id"));
    const o = await assertOrderAccess(u, id, true);
    const next = {
      orderDate: fdate(fd.get("orderDate")) ?? o.orderDate,
      supplierId: fstr(fd.get("supplierId")) ?? o.supplierId,
      buyerId: can(u, PERMS.ordersViewAll) ? fstr(fd.get("buyerId")) : o.buyerId,
      legalEntityId: fstr(fd.get("legalEntityId")),
      directionId: fstr(fd.get("directionId")),
      invoiceNumber: fstr(fd.get("invoiceNumber")),
      invoiceDate: fdate(fd.get("invoiceDate")),
      plannedDeliveryDate: fdate(fd.get("plannedDeliveryDate")),
      comment: fstr(fd.get("comment")),
    };
    const changes = diff(o as unknown as Record<string, unknown>, next, {
      orderDate: "Дата заказа",
      supplierId: "Поставщик",
      buyerId: "Закупщик",
      legalEntityId: "Юрлицо",
      directionId: "Направление",
      invoiceNumber: "№ счёта",
      invoiceDate: "Дата счёта",
      plannedDeliveryDate: "Плановая дата поставки",
      comment: "Комментарий",
    });
    if (!Object.keys(changes).length) return { ok: "Изменений нет" };
    await db.transaction(async (tx) => {
      await tx.update(schema.purchaseOrders).set({ ...next, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
      await logActivity(tx, { userId: u.id, action: "update", entityType: "order", entityId: id, summary: `Изменён заказ ${orderNo(o.number)}`, changes, ip: await clientIp() });
      if (next.buyerId && next.buyerId !== o.buyerId) await notify(tx, { userId: next.buyerId, type: "order_assigned", title: `Вам назначен заказ ${orderNo(o.number)}`, link: `/orders/${id}` });
    });
    revalidatePath(`/orders/${id}`);
    return { ok: "Сохранено" };
  });
}

export async function setOrderStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const id = String(fd.get("id"));
    const status = String(fd.get("status")) as Status;
    const o = await assertOrderAccess(u, id, true);
    if (!(status in ORDER_STATUS_LABEL)) throw new UserError("Неизвестный статус");
    if (status === "CANCELLED" && !can(u, PERMS.ordersCancel)) throw new UserError("Отменять заказы может только руководитель");
    if (status === "PARTIAL" || status === "DELIVERED") throw new UserError("Статусы «Частично/Полностью поставлен» ставятся автоматически по поставкам");
    await db.transaction(async (tx) => {
      await tx.update(schema.purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
      // после возврата из «Отменён» статус пересчитывается по факту поставок
      if (status !== "CANCELLED") await recalcOrderStatus(tx, id);
      const [n] = await tx.select({ s: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
      await logActivity(tx, { userId: u.id, action: "status", entityType: "order", entityId: id, summary: `Статус заказа ${orderNo(o.number)}: ${ORDER_STATUS_LABEL[o.status]} → ${ORDER_STATUS_LABEL[n.s]}`, changes: { Статус: [ORDER_STATUS_LABEL[o.status], ORDER_STATUS_LABEL[n.s]] }, ip: await clientIp() });
    });
    revalidatePath(`/orders/${id}`);
    return { ok: "Статус изменён" };
  });
}

export async function addItemAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const id = String(fd.get("id"));
    const o = await assertOrderAccess(u, id, true);
    const items = readItems(fd);
    if (!items.length) throw new UserError("Укажите товар и количество");
    if (!fd.get("confirm")) {
      for (const it of items) {
        if (await findProductExact(db, it.name)) continue;
        const sim = await similarProducts(it.name, 3);
        if (sim.length) return { needConfirm: `«${it.name}» похоже на ${sim.map((s) => `«${s.name}»`).join(", ")}. Создать новый товар?` };
      }
    }
    await db.transaction(async (tx) => {
      for (const it of items) {
        const p = await ensureProduct(tx, it.name);
        await linkProductSupplier(tx, p.id, o.supplierId);
        await tx.insert(schema.purchaseOrderItems).values({ orderId: id, productId: p.id, directionId: it.directionId, plannedDeliveryDate: it.due, qty: String(it.qty), price: it.price === null ? null : String(it.price), sortOrder: 999 });
        await logActivity(tx, { userId: u.id, action: "update", entityType: "order", entityId: id, summary: `Добавлена позиция «${it.name}»: ${it.qty} × ${it.price ?? "—"}` });
      }
      await recalcOrderStatus(tx, id);
    });
    revalidatePath(`/orders/${id}`);
    return { ok: "Позиция добавлена" };
  });
}

export async function updateItemAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const itemId = String(fd.get("itemId"));
    const [it] = await db.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, itemId));
    if (!it) throw new UserError("Позиция не найдена");
    const o = await assertOrderAccess(u, it.orderId, true);
    const qty = fnum(fd.get("qty"));
    const price = fnum(fd.get("price"));
    if (qty === null || Number.isNaN(qty) || qty <= 0) throw new UserError("Количество должно быть больше нуля");
    if (price !== null && (Number.isNaN(price) || price < 0)) throw new UserError("Неверная цена");
    const isClosed = fd.get("isClosed") === "on";
    const approve = fd.get("overDeliveryApproved") === "on";
    if (approve !== it.overDeliveryApproved && !can(u, PERMS.overDeliveryApprove)) throw new UserError("Разрешать превышение может только руководитель");
    const [prog] = await itemProgress(db, [it.orderId]).then((r) => r.filter((x) => x.id === itemId));
    if (qty < prog.delivered && !approve && !it.overDeliveryApproved) throw new UserError(`Уже поставлено ${prog.delivered} — нельзя заказать меньше без разрешения превышения`);
    if (fstr(fd.get("due")) && !fdate(fd.get("due"))) throw new UserError("Неверный срок поставки");
    // пустой срок — позиция снова идёт по общему сроку заказа
    const next = { qty: String(qty), price: price === null ? null : String(price), plannedDeliveryDate: fdate(fd.get("due")), isClosed, closedNote: isClosed ? fstr(fd.get("closedNote")) ?? it.closedNote : null, overDeliveryApproved: approve };
    const changes = diff(it as unknown as Record<string, unknown>, next, { qty: "Количество", price: "Цена", plannedDeliveryDate: "Срок поставки позиции", isClosed: "Закрыта", closedNote: "Причина закрытия", overDeliveryApproved: "Превышение разрешено" });
    if (!Object.keys(changes).length) return { ok: "Изменений нет" };
    const [p] = await db.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.id, it.productId));
    await db.transaction(async (tx) => {
      await tx.update(schema.purchaseOrderItems).set(next).where(eq(schema.purchaseOrderItems.id, itemId));
      await recalcOrderStatus(tx, it.orderId);
      await logActivity(tx, { userId: u.id, action: "update", entityType: "order", entityId: it.orderId, summary: `Изменена позиция «${p.name}» в заказе ${orderNo(o.number)}`, changes, ip: await clientIp() });
    });
    revalidatePath(`/orders/${it.orderId}`);
    return { ok: "Сохранено" };
  });
}

export async function deleteItemAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const itemId = String(fd.get("itemId"));
    const [it] = await db.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, itemId));
    if (!it) throw new UserError("Позиция не найдена");
    await assertOrderAccess(u, it.orderId, true);
    const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deliveryItems).where(eq(schema.deliveryItems.orderItemId, itemId));
    if (d.n > 0) throw new UserError("По позиции уже есть поставки — удалить нельзя. Закройте позицию вместо удаления.");
    const [p] = await db.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.id, it.productId));
    await db.transaction(async (tx) => {
      await tx.delete(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, itemId));
      await recalcOrderStatus(tx, it.orderId);
      await logActivity(tx, { userId: u.id, action: "delete", entityType: "order", entityId: it.orderId, summary: `Удалена позиция «${p.name}» (${it.qty} × ${it.price ?? "—"})`, changes: { Позиция: [`${p.name}: ${it.qty} × ${it.price ?? "—"}`, null] } });
    });
    revalidatePath(`/orders/${it.orderId}`);
  });
}

export async function deleteOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.deleteRecords);
    const id = String(fd.get("id"));
    const o = await assertOrderAccess(u, id);
    await db.transaction(async (tx) => {
      await tx.update(schema.purchaseOrders).set({ deletedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
      await logActivity(tx, { userId: u.id, action: "delete", entityType: "order", entityId: id, summary: `Заказ ${orderNo(o.number)} перемещён в удалённые (можно восстановить)` });
    });
  });
  if (r && "error" in r) return r;
  redirect("/orders");
}

export async function restoreOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.deleteRecords);
    const id = String(fd.get("id"));
    await db.update(schema.purchaseOrders).set({ deletedAt: null }).where(eq(schema.purchaseOrders.id, id));
    await logActivity(db, { userId: u.id, action: "restore", entityType: "order", entityId: id, summary: "Заказ восстановлен" });
    revalidatePath("/settings");
    return { ok: "Восстановлено" };
  });
}

// ---------- поставки ----------

export async function registerDeliveryAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const orderId = String(fd.get("orderId"));
    const o = await assertOrderAccess(u, orderId, true);
    if (o.status === "CANCELLED") throw new UserError("Заказ отменён — поставки по нему не регистрируются");
    const date = fdate(fd.get("date"));
    if (!date) throw new UserError("Укажите дату фактической поставки");
    if (date > today()) throw new UserError("Дата поставки не может быть в будущем");
    const ids = fd.getAll("di_item").map(String);
    const qtys = fd.getAll("di_qty");
    const prices = fd.getAll("di_price");
    const progress = await itemProgress(db, [orderId]);
    const lines: { itemId: string; productId: string; qty: number; price: number | null }[] = [];
    ids.forEach((itemId, i) => {
      const q = fnum(qtys[i]);
      if (q === null || q === 0) return;
      if (Number.isNaN(q) || q < 0) throw new UserError("Количество должно быть положительным числом");
      const p = fnum(prices[i]);
      if (p !== null && (Number.isNaN(p) || p < 0)) throw new UserError("Неверная цена");
      const it = progress.find((x) => x.id === itemId);
      if (!it) throw new UserError("Позиция не принадлежит заказу");
      lines.push({ itemId, productId: it.productId, qty: q, price: p ?? it.price });
    });
    if (!lines.length) throw new UserError("Укажите количество хотя бы по одной позиции");

    // превышение заказанного количества — только с подтверждением руководителя
    const names = new Map((await db.select({ id: schema.purchaseOrderItems.id, name: schema.products.name }).from(schema.purchaseOrderItems).innerJoin(schema.products, eq(schema.products.id, schema.purchaseOrderItems.productId)).where(eq(schema.purchaseOrderItems.orderId, orderId))).map((r) => [r.id, r.name]));
    const over = checkOverDelivery(progress.map((p) => ({ ...p, name: names.get(p.id) })), new Map(lines.map((l) => [l.itemId, l.qty])));
    let approvedOver = false;
    if (over.length) {
      const text = over.map((x) => `«${x.name}»: заказано ${x.ordered}, будет ${x.total}`).join("; ");
      if (!can(u, PERMS.overDeliveryApprove)) {
        if (fd.get("confirm")) {
          const admins = await db.execute(sql`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.is_active`);
          for (const a of admins.rows as { id: string }[]) await notify(db, { userId: a.id, type: "over_delivery_request", title: `Запрос на поставку сверх заказа ${orderNo(o.number)}`, body: `${u.name}: ${text}`, link: `/orders/${orderId}` });
          return { ok: "Запрос отправлен руководителю. После разрешения превышения зарегистрируйте поставку ещё раз." };
        }
        return { needConfirm: `Превышение заказанного количества: ${text}. Нужно подтверждение руководителя. Отправить запрос?` };
      }
      if (!fd.get("confirm")) return { needConfirm: `Превышение заказанного количества: ${text}. Подтвердить как руководитель?` };
      approvedOver = true;
    }

    await db.transaction(async (tx) => {
      const [d] = await tx.insert(schema.deliveries).values({ orderId, supplierId: o.supplierId, date, waybillNumber: fstr(fd.get("waybillNumber")), comment: fstr(fd.get("comment")), createdById: u.id }).returning();
      for (const l of lines) await tx.insert(schema.deliveryItems).values({ deliveryId: d.id, orderItemId: l.itemId, productId: l.productId, qty: String(l.qty), price: l.price === null ? null : String(l.price) });
      if (approvedOver) await tx.update(schema.purchaseOrderItems).set({ overDeliveryApproved: true }).where(inArray(schema.purchaseOrderItems.id, over.map((x) => x.itemId)));
      const [was, now] = await recalcOrderStatus(tx, orderId);
      const total = lines.reduce((s, l) => s + l.qty, 0);
      await logActivity(tx, {
        userId: u.id,
        action: "create",
        entityType: "delivery",
        entityId: d.id,
        summary: `Поставка по заказу ${orderNo(o.number)} от ${date}: ${total} ед. (${lines.length} поз.)${approvedOver ? ", превышение подтверждено руководителем" : ""}`,
        changes: was !== now ? { "Статус заказа": [ORDER_STATUS_LABEL[was], ORDER_STATUS_LABEL[now]] } : null,
        ip: await clientIp(),
      });
      await logActivity(tx, { userId: u.id, action: "delivery", entityType: "order", entityId: orderId, summary: `Зарегистрирована поставка от ${date}: ${total} ед.` });
    });
    revalidatePath(`/orders/${orderId}`);
    return { ok: "Поставка зарегистрирована" };
  });
}

export async function deleteDeliveryAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const id = String(fd.get("id"));
    const [d] = await db.select().from(schema.deliveries).where(and(eq(schema.deliveries.id, id), isNull(schema.deliveries.deletedAt)));
    if (!d) throw new UserError("Поставка не найдена");
    const o = await assertOrderAccess(u, d.orderId, true);
    if (!can(u, PERMS.deleteRecords) && d.createdById !== u.id) throw new UserError("Удалить можно только свою поставку");
    await db.transaction(async (tx) => {
      await tx.update(schema.deliveries).set({ deletedAt: new Date() }).where(eq(schema.deliveries.id, id));
      await recalcOrderStatus(tx, d.orderId);
      await logActivity(tx, { userId: u.id, action: "delete", entityType: "delivery", entityId: id, summary: `Отменена регистрация поставки от ${d.date} по заказу ${orderNo(o.number)}` });
      await logActivity(tx, { userId: u.id, action: "delete", entityType: "order", entityId: d.orderId, summary: `Удалена поставка от ${d.date}` });
    });
    revalidatePath(`/orders/${d.orderId}`);
  });
}

// ---------- оплаты ----------

export async function registerPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    if (!can(u, PERMS.ordersEdit)) throw new UserError("Недостаточно прав");
    const orderId = fstr(fd.get("orderId"));
    let supplierId = fstr(fd.get("supplierId"));
    let legalEntityId = fstr(fd.get("legalEntityId"));
    let label = "";
    if (orderId) {
      const o = await assertOrderAccess(u, orderId, true);
      supplierId = o.supplierId;
      legalEntityId = legalEntityId ?? o.legalEntityId;
      label = ` по заказу ${orderNo(o.number)}`;
    } else if (!can(u, PERMS.ordersViewAll)) {
      // аванс без счёта — закупщик может только по своим поставщикам
      const [link] = await db.select().from(schema.supplierBuyers).where(and(eq(schema.supplierBuyers.supplierId, supplierId ?? ""), eq(schema.supplierBuyers.userId, u.id)));
      if (!link) throw new UserError("Аванс без заказа можно внести только по своему поставщику");
    }
    if (!supplierId) throw new UserError("Выберите поставщика или заказ");
    const amount = fnum(fd.get("amount"));
    if (amount === null || Number.isNaN(amount) || amount === 0) throw new UserError("Укажите сумму платежа");
    const date = fdate(fd.get("date"));
    if (!date) throw new UserError("Укажите дату платежа");
    const type = (fstr(fd.get("type")) ?? "PARTIAL") as "ADVANCE" | "PARTIAL" | "FULL";
    const method = (fstr(fd.get("method")) ?? "BANK") as "BANK" | "CASH";
    await db.transaction(async (tx) => {
      const [p] = await tx.insert(schema.payments).values({ supplierId: supplierId!, orderId, legalEntityId, type, method, date, amount: String(amount), docNumber: fstr(fd.get("docNumber")), comment: fstr(fd.get("comment")), createdById: u.id }).returning();
      await logActivity(tx, { userId: u.id, action: "create", entityType: "payment", entityId: p.id, summary: `Оплата ${amount.toLocaleString("ru-RU")} ₽ от ${date}${label}`, ip: await clientIp() });
      if (orderId) await logActivity(tx, { userId: u.id, action: "payment", entityType: "order", entityId: orderId, summary: `Зарегистрирована оплата ${amount.toLocaleString("ru-RU")} ₽ от ${date}` });
    });
    if (orderId) revalidatePath(`/orders/${orderId}`);
    revalidatePath("/payments");
    return { ok: "Оплата зарегистрирована" };
  });
}

export async function deletePaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const id = String(fd.get("id"));
    const [p] = await db.select().from(schema.payments).where(and(eq(schema.payments.id, id), isNull(schema.payments.deletedAt)));
    if (!p) throw new UserError("Платёж не найден");
    if (p.orderId) await assertOrderAccess(u, p.orderId, true);
    if (!can(u, PERMS.deleteRecords) && p.createdById !== u.id) throw new UserError("Удалить можно только свой платёж");
    await db.transaction(async (tx) => {
      await tx.update(schema.payments).set({ deletedAt: new Date() }).where(eq(schema.payments.id, id));
      await logActivity(tx, { userId: u.id, action: "delete", entityType: "payment", entityId: id, summary: `Удалена оплата ${p.amount} ₽ от ${p.date ?? "—"}`, changes: { Сумма: [p.amount, null] } });
      if (p.orderId) await logActivity(tx, { userId: u.id, action: "delete", entityType: "order", entityId: p.orderId, summary: `Удалена оплата ${p.amount} ₽` });
    });
    if (p.orderId) revalidatePath(`/orders/${p.orderId}`);
    revalidatePath("/payments");
  });
}

// ---------- комментарии ----------

export async function addCommentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const entityType = String(fd.get("entityType"));
    const entityId = String(fd.get("entityId"));
    const text = fstr(fd.get("text"));
    if (!text) throw new UserError("Пустой комментарий");
    if (!["order", "supplier"].includes(entityType)) throw new UserError("Неверный объект");
    if (entityType === "order") await assertOrderAccess(u, entityId);
    if (u.role === "VIEWER") throw new UserError("Наблюдатель не может оставлять комментарии");
    await db.insert(schema.comments).values({ entityType, entityId, authorId: u.id, text });
    revalidatePath(entityType === "order" ? `/orders/${entityId}` : `/suppliers/${entityId}`);
    return { ok: "Добавлено" };
  });
}
