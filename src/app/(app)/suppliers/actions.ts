"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, requirePerm } from "@/lib/auth";
import { PERMS, can } from "@/lib/permissions";
import { diff, logActivity, notify } from "@/lib/audit";
import { fdate, fstr, safe, UserError } from "@/lib/forms";
import { normKey } from "@/lib/normalize";
import type { ActionResult } from "@/components/client";

const LABELS = {
  name: "Название",
  legalName: "Юридическое лицо",
  inn: "ИНН",
  contactPerson: "Контактное лицо",
  phone: "Телефон",
  email: "Email",
  address: "Адрес",
  bankDetails: "Банковские реквизиты",
  activity: "Направление деятельности",
  comment: "Комментарий",
  status: "Статус",
  startedAt: "Начало сотрудничества",
};

function read(fd: FormData) {
  const name = fstr(fd.get("name"));
  if (!name) throw new UserError("Укажите название компании");
  const inn = fstr(fd.get("inn"));
  if (inn && !/^\d{10}(\d{2})?$/.test(inn)) throw new UserError("ИНН — 10 или 12 цифр");
  const email = fstr(fd.get("email"));
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Неверный email");
  return {
    name,
    legalName: fstr(fd.get("legalName")),
    inn,
    contactPerson: fstr(fd.get("contactPerson")),
    phone: fstr(fd.get("phone")),
    email,
    address: fstr(fd.get("address")),
    bankDetails: fstr(fd.get("bankDetails")),
    activity: fstr(fd.get("activity")),
    comment: fstr(fd.get("comment")),
    status: (fstr(fd.get("status")) ?? "ACTIVE") as "ACTIVE",
    startedAt: fdate(fd.get("startedAt")),
  };
}

export async function createSupplierAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.suppliersEdit);
    const v = read(fd);
    const key = normKey(v.name);
    const [ex] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.key, key));
    if (ex) throw new UserError(`Поставщик «${ex.name}» уже есть в справочнике`);
    await db.transaction(async (tx) => {
      const [s] = await tx.insert(schema.suppliers).values({ ...v, key }).returning();
      id = s.id;
      // создавший закупщик становится ответственным
      if (u.role === "BUYER") await tx.insert(schema.supplierBuyers).values({ supplierId: s.id, userId: u.id, isPrimary: true });
      await logActivity(tx, { userId: u.id, action: "create", entityType: "supplier", entityId: s.id, summary: `Создан поставщик «${v.name}»`, ip: await clientIp() });
    });
  });
  if (r && "error" in r) return r;
  redirect(`/suppliers/${id}`);
}

export async function updateSupplierAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.suppliersEdit);
    const id = String(fd.get("id"));
    const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    if (!s) throw new UserError("Поставщик не найден");
    const v = read(fd);
    const key = normKey(v.name);
    const [ex] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.key, key), ne(schema.suppliers.id, id)));
    if (ex) throw new UserError(`Поставщик «${ex.name}» уже есть`);
    const changes = diff(s as unknown as Record<string, unknown>, v, LABELS);
    if (!Object.keys(changes).length) return { ok: "Изменений нет" };
    await db.transaction(async (tx) => {
      await tx.update(schema.suppliers).set({ ...v, key, updatedAt: new Date() }).where(eq(schema.suppliers.id, id));
      await logActivity(tx, { userId: u.id, action: "update", entityType: "supplier", entityId: id, summary: `Изменён поставщик «${v.name}»`, changes, ip: await clientIp() });
    });
    revalidatePath(`/suppliers/${id}`);
    return { ok: "Сохранено" };
  });
}

export async function setSupplierBuyersAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.ordersViewAll);
    const id = String(fd.get("id"));
    const ids = fd.getAll("buyer").map(String).filter(Boolean);
    const primary = fstr(fd.get("primary"));
    const before = await db.select({ userId: schema.supplierBuyers.userId, name: schema.users.name }).from(schema.supplierBuyers).innerJoin(schema.users, eq(schema.users.id, schema.supplierBuyers.userId)).where(eq(schema.supplierBuyers.supplierId, id));
    const [s] = await db.select({ name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.id, id));
    await db.transaction(async (tx) => {
      await tx.delete(schema.supplierBuyers).where(eq(schema.supplierBuyers.supplierId, id));
      for (const b of ids) await tx.insert(schema.supplierBuyers).values({ supplierId: id, userId: b, isPrimary: b === primary || ids.length === 1 });
      const after = ids.length ? await tx.select({ id: schema.users.id, name: schema.users.name }).from(schema.users) : [];
      const names = after.filter((x) => ids.includes(x.id)).map((x) => x.name);
      await logActivity(tx, { userId: u.id, action: "update", entityType: "supplier", entityId: id, summary: "Изменены ответственные закупщики", changes: { Закупщики: [before.map((b) => b.name).join(", "), names.join(", ")] } });
      for (const b of ids.filter((x) => !before.some((y) => y.userId === x))) await notify(tx, { userId: b, type: "supplier_assigned", title: `Вы ответственны за поставщика «${s.name}»`, link: `/suppliers/${id}` });
    });
    revalidatePath(`/suppliers/${id}`);
    return { ok: "Сохранено" };
  });
}

export async function deleteSupplierAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.deleteRecords);
    const id = String(fd.get("id"));
    const [cnt] = await db.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.supplierId, id), isNull(schema.purchaseOrders.deletedAt))).limit(1);
    if (cnt) throw new UserError("У поставщика есть заказы — удалить нельзя. Поставьте статус «Прекращено».");
    await db.update(schema.suppliers).set({ deletedAt: new Date() }).where(eq(schema.suppliers.id, id));
    await logActivity(db, { userId: u.id, action: "delete", entityType: "supplier", entityId: id, summary: "Поставщик удалён (можно восстановить)" });
  });
  if (r && "error" in r) return r;
  redirect("/suppliers");
}

void can;
