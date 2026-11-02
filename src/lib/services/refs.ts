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

export async function selectOptions() {
  const [suppliers, products, legal, directions, buyers] = await Promise.all([
    db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).where(isNull(schema.suppliers.deletedAt)).orderBy(asc(schema.suppliers.name)),
    db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(and(isNull(schema.products.mergedIntoId), eq(schema.products.isActive, true))).orderBy(asc(schema.products.name)),
    db.select({ id: schema.legalEntities.id, name: schema.legalEntities.name }).from(schema.legalEntities).where(eq(schema.legalEntities.isActive, true)).orderBy(asc(schema.legalEntities.name)),
    db.select({ id: schema.directions.id, name: schema.directions.name }).from(schema.directions).orderBy(asc(schema.directions.name)),
    db.execute(sql`SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active AND r.code IN ('BUYER','ADMIN') ORDER BY u.name`),
  ]);
  return { suppliers, products, legal, directions, buyers: buyers.rows as { id: string; name: string }[] };
}

export const opt = (rows: { id: string; name: string }[]) => rows.map((r) => ({ value: r.id, label: r.name }));
