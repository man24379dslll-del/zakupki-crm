"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { diff, logActivity } from "@/lib/audit";
import { fstr, safe, UserError } from "@/lib/forms";
import { normKey } from "@/lib/normalize";
import { findProductExact, similarProducts } from "@/lib/services/refs";
import type { ActionResult } from "@/components/client";

function read(fd: FormData) {
  const name = fstr(fd.get("name"));
  if (!name) throw new UserError("Укажите название товара");
  return { name, sku: fstr(fd.get("sku")), category: fstr(fd.get("category")), unit: fstr(fd.get("unit")) ?? "шт", description: fstr(fd.get("description")), isActive: fd.get("isActive") !== "off" };
}

export async function createProductAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.productsEdit);
    const v = read(fd);
    const ex = await findProductExact(db, v.name);
    if (ex) throw new UserError(`Товар «${ex.name}» уже есть в справочнике`);
    if (!fd.get("confirm")) {
      const sim = await similarProducts(v.name);
      if (sim.length) return { needConfirm: `Похожие товары уже есть: ${sim.map((s) => `«${s.name}»`).join(", ")}. Это точно новый товар?` };
    }
    const [p] = await db.insert(schema.products).values({ ...v, key: normKey(v.name) }).returning();
    id = p.id;
    await logActivity(db, { userId: u.id, action: "create", entityType: "product", entityId: p.id, summary: `Создан товар «${v.name}»`, ip: await clientIp() });
  });
  if (r && ("error" in r || "needConfirm" in r)) return r;
  redirect(`/products/${id}`);
}

export async function updateProductAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.productsEdit);
    const id = String(fd.get("id"));
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id));
    if (!p) throw new UserError("Товар не найден");
    const v = { ...read(fd), isActive: fd.get("isActive") === "on" };
    const key = normKey(v.name);
    const [dup] = await db.select().from(schema.products).where(and(eq(schema.products.key, key), ne(schema.products.id, id)));
    if (dup && !dup.mergedIntoId) throw new UserError(`Товар «${dup.name}» уже есть — объедините дубли вместо переименования`);
    const changes = diff(p as unknown as Record<string, unknown>, v, { name: "Название", sku: "Артикул", category: "Категория", unit: "Ед. изм.", description: "Описание", isActive: "Активен" });
    if (!Object.keys(changes).length) return { ok: "Изменений нет" };
    await db.update(schema.products).set({ ...v, key, updatedAt: new Date() }).where(eq(schema.products.id, id));
    await logActivity(db, { userId: u.id, action: "update", entityType: "product", entityId: id, summary: `Изменён товар «${v.name}»`, changes });
    revalidatePath(`/products/${id}`);
    return { ok: "Сохранено" };
  });
}

/** Объединение дублей: все позиции заказов, поставки, план и связи переносятся на основной товар */
export async function mergeProductsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.productsMerge);
    const target = String(fd.get("target"));
    const sources = fd.getAll("source").map(String).filter((s) => s && s !== target);
    if (!sources.length) throw new UserError("Выберите дубли для объединения");
    const [t] = await db.select().from(schema.products).where(eq(schema.products.id, target));
    if (!t) throw new UserError("Основной товар не найден");
    await db.transaction(async (tx) => {
      for (const s of sources) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, s));
        if (!p) continue;
        await tx.update(schema.purchaseOrderItems).set({ productId: target }).where(eq(schema.purchaseOrderItems.productId, s));
        await tx.update(schema.deliveryItems).set({ productId: target }).where(eq(schema.deliveryItems.productId, s));
        await tx.update(schema.supplyPlanEntries).set({ productId: target }).where(eq(schema.supplyPlanEntries.productId, s));
        await tx.execute(sql`INSERT INTO product_suppliers (product_id, supplier_id, is_main) SELECT ${target}, supplier_id, false FROM product_suppliers WHERE product_id = ${s} ON CONFLICT DO NOTHING`);
        await tx.delete(schema.productSuppliers).where(eq(schema.productSuppliers.productId, s));
        await tx.update(schema.products).set({ mergedIntoId: target, isActive: false }).where(eq(schema.products.id, s));
        await logActivity(tx, { userId: u.id, action: "merge", entityType: "product", entityId: target, summary: `Объединён дубль «${p.name}» → «${t.name}»`, changes: { Товар: [p.name, t.name] }, ip: await clientIp() });
      }
    });
    revalidatePath(`/products/${target}`);
    return { ok: `Объединено: ${sources.length}` };
  });
}
