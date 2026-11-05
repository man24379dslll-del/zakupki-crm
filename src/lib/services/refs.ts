import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { isSimilar, normKey } from "@/lib/normalize";

type X = Tx | typeof db;

export async function ensureLegalEntity(tx: X, name: string | null | undefined) {
  if (!name?.trim()) return null;
  const key = normKey(name);
  const [ex] = await tx.select().from(schema.legalEntities).where(eq(schema.legalEntities.key, key));
  if (ex) return ex.id;
  const [c] = await tx.insert(schema.legalEntities).values({ name: name.trim(), key }).returning();
  return c.id;
}

export async function ensureDirection(tx: X, name: string | null | undefined) {
  if (!name?.trim()) return null;
  const key = normKey(name);
  const [ex] = await tx.select().from(schema.directions).where(eq(schema.directions.key, key));
  if (ex) return ex.id;
  const [c] = await tx.insert(schema.directions).values({ name: name.trim(), key }).returning();
  return c.id;
}

export async function ensureSupplier(tx: X, name: string) {
  const key = normKey(name);
  const [ex] = await tx.select().from(schema.suppliers).where(eq(schema.suppliers.key, key));
  if (ex) return { id: ex.id, created: false };
  const [c] = await tx.insert(schema.suppliers).values({ name: name.trim(), key }).returning();
  return { id: c.id, created: true };
}

/** Поиск товара: точное совпадение ключа (с учётом объединённых дублей) */
export async function findProductExact(tx: X, name: string) {
  const key = normKey(name);
  const [p] = await tx.select().from(schema.products).where(eq(schema.products.key, key)).limit(1);
  if (!p) return null;
  if (p.mergedIntoId) {
    const [m] = await tx.select().from(schema.products).where(eq(schema.products.id, p.mergedIntoId));
    return m ?? p;
  }
  return p;
}

/** Похожие товары — подсказка, чтобы не плодить дубли */
export async function similarProducts(name: string, limit = 5) {
  const all = await db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(isNull(schema.products.mergedIntoId));
  return all.filter((p) => isSimilar(p.name, name) && normKey(p.name) !== normKey(name)).slice(0, limit);
}

export async function ensureProduct(tx: X, name: string, opts?: { category?: string }) {
  const ex = await findProductExact(tx, name);
  if (ex) return { id: ex.id, created: false };
  const [c] = await tx.insert(schema.products).values({ name: name.trim(), key: normKey(name), category: opts?.category ?? null }).returning();
  return { id: c.id, created: true };
}

export async function linkProductSupplier(tx: X, productId: string, supplierId: string) {
  await tx.insert(schema.productSuppliers).values({ productId, supplierId }).onConflictDoNothing();
}

type Ref = { id: string; name: string; hint?: string | null };

/**
 * Варианты для выпадающих списков. hint — по нему тоже ищут (ИНН, артикул, полное название юрлица).
 * Скрытые юрлица и направления не предлагаются; inactive: true — показать все (фильтры по истории),
 * массив id — добавить только эти (текущее значение редактируемого заказа).
 */
export async function selectOptions(o: { inactive?: true | (string | null | undefined)[] } = {}) {
  const keep = (active: boolean, id: string) => active || o.inactive === true || (Array.isArray(o.inactive) && o.inactive.includes(id));
  const [suppliers, products, legal, directions, buyers] = await Promise.all([
    db.select({ id: schema.suppliers.id, name: schema.suppliers.name, hint: schema.suppliers.inn }).from(schema.suppliers).where(isNull(schema.suppliers.deletedAt)).orderBy(asc(schema.suppliers.name)),
    db.select({ id: schema.products.id, name: schema.products.name, hint: schema.products.sku }).from(schema.products).where(and(isNull(schema.products.mergedIntoId), eq(schema.products.isActive, true))).orderBy(asc(schema.products.name)),
    db.select().from(schema.legalEntities).orderBy(asc(sql`COALESCE(${schema.legalEntities.shortName}, ${schema.legalEntities.name})`)),
    db.select().from(schema.directions).orderBy(asc(schema.directions.name)),
    db.execute(sql`SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active AND r.code IN ('BUYER','ADMIN') ORDER BY u.name`),
  ]);
  return {
    suppliers,
    products,
    legal: legal
      .filter((l) => keep(l.isActive, l.id))
      .map((l): Ref => ({ id: l.id, name: l.shortName || l.name, hint: [l.shortName ? l.name : null, l.isActive ? null : "скрыто"].filter(Boolean).join(" · ") || null })),
    directions: directions.filter((d) => keep(d.isActive, d.id)).map((d): Ref => ({ id: d.id, name: d.name, hint: d.isActive ? null : "скрыто" })),
    buyers: buyers.rows as Ref[],
  };
}

export const opt = (rows: Ref[]) => rows.map((r) => ({ value: r.id, label: r.name, hint: r.hint ?? null }));

/** Как показывать юрлицо: короткое название, если задано */
export const legalLabel = (l: { name: string; shortName?: string | null } | null | undefined) => (l ? l.shortName || l.name : null);
