/**
 * Импорт разобранного Excel в БД: предпросмотр (без записи) и выполнение (одна транзакция).
 * Все записи помечаются import_batch_id и ссылкой на лист/строку, поэтому импорт можно откатить.
 */
import { createHash } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, schema, type Tx } from "../../db";
import { isSimilar, normKey } from "../normalize";
import { computeStatus } from "../calc";
import type { Issue, ParsedOrder, ParsedSheet, ParseResult } from "./parser";

export interface SheetSettings {
  enabled: boolean;
  buyerId?: string | null;
  /** название поставщика для листа без контрагента (например, «Юля-(ЛАКИ)») */
  supplierName?: string | null;
}

export interface ImportSettings {
  sheets: Record<string, SheetSettings>;
  /** объединение похожих названий: исходный ключ → итоговое название */
  merges: Record<string, string>;
  leadDays: number;
  /** позиции с вручную обнулённым остатком считать закрытыми */
  closeManual: boolean;
  /** импортировать авансы без привязки к счёту */
  supplierAdvances: boolean;
  /** «ост.поставщики»: создавать поставку на дату счёта, если дата поставки не указана */
  assumeSimpleDeliveries: boolean;
}

export function defaultSettings(p: ParseResult): ImportSettings {
  const sheets: Record<string, SheetSettings> = {};
  for (const s of p.sheets) {
    const dup = (s as ParsedSheet & { duplicateOf?: string }).duplicateOf;
    const fallback = s.issues.some((i) => i.code === "SUPPLIER_FROM_SHEET");
    sheets[s.name] = { enabled: s.kind !== "unknown" && !dup, buyerId: null, supplierName: fallback ? s.name : null };
  }
  const merges: Record<string, string> = {};
  for (const sug of suggestMerges(p, sheets)) if (sug.kind !== "product") merges[normKey(sug.from)] = sug.to;
  return { sheets, merges, leadDays: 30, closeManual: true, supplierAdvances: true, assumeSimpleDeliveries: true };
}

export interface MergeSuggestion {
  kind: "legal" | "supplier" | "product";
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
}

/** Похожие (но не идентичные) названия: предлагаем объединить в более частое */
export function suggestMerges(p: ParseResult, sheets: Record<string, SheetSettings>): MergeSuggestion[] {
  const counters = { legal: new Map<string, number>(), supplier: new Map<string, number>(), product: new Map<string, number>() };
  const names = { legal: new Map<string, string>(), supplier: new Map<string, string>(), product: new Map<string, string>() };
  const add = (k: keyof typeof counters, v: string | null | undefined) => {
    if (!v) return;
    const key = normKey(v);
    counters[k].set(key, (counters[k].get(key) ?? 0) + 1);
    if (!names[k].has(key)) names[k].set(key, v);
  };
  for (const s of p.sheets) {
    if (!sheets[s.name]?.enabled) continue;
    for (const o of s.orders) {
      add("legal", o.legalEntity);
      add("supplier", o.supplier);
      for (const it of o.items) add("product", it.product);
    }
    for (const r of s.plan) {
      add("supplier", r.supplier);
      add("product", r.product);
    }
  }
  const out: MergeSuggestion[] = [];
  for (const kind of ["legal", "supplier", "product"] as const) {
    const keys = [...counters[kind].keys()];
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = names[kind].get(keys[i])!,
          b = names[kind].get(keys[j])!;
        if (!isSimilar(a, b)) continue;
        const ca = counters[kind].get(keys[i])!,
          cb = counters[kind].get(keys[j])!;
        const [from, to, fc, tc] = ca >= cb ? [b, a, cb, ca] : [a, b, ca, cb];
        out.push({ kind, from, to, fromCount: fc, toCount: tc });
      }
  }
  return out;
}

function fingerprint(sheet: string, o: ParsedOrder, supplier: string) {
  const items = o.items.map((i) => `${normKey(i.product)}:${i.qty}:${i.price}`).sort().join(";");
  return createHash("sha1").update([normKey(supplier), o.invoice ?? "", o.orderDate ?? "", items].join("|")).digest("hex").slice(0, 16);
}

function addDays(iso: string, d: number) {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}

export interface PreviewOrder {
  sheet: string;
  rows: string;
  supplier: string;
  invoice: string | null;
  orderDate: string | null;
  items: number;
  amount: number;
  qty: number;
  delivered: number;
  paid: number;
  status: string;
  duplicateInDb: boolean;
  fp: string;
}

export interface Preview {
  sheets: {
    name: string;
    kind: string;
    enabled: boolean;
    duplicateOf?: string;
    orders: number;
    items: number;
    deliveries: number;
    payments: number;
    supplierPayments: number;
    plan: number;
    skipped: number;
    totals: { amount: number; qty: number; delivered: number; paid: number };
    excel?: { qty?: number; amount?: number; delivered?: number; paid?: number };
  }[];
  counts: { suppliers: number; newSuppliers: number; products: number; newProducts: number; legal: number; orders: number; items: number; deliveries: number; payments: number; plan: number; duplicatesInDb: number; skippedRows: number };
  issues: Issue[];
  merges: MergeSuggestion[];
  orders: PreviewOrder[];
}

function resolveName(settings: ImportSettings, v: string | null | undefined) {
  if (!v) return v ?? null;
  return settings.merges[normKey(v)] ?? v;
}

function supplierOf(s: ParsedSheet, o: ParsedOrder, settings: ImportSettings) {
  const st = settings.sheets[s.name];
  const raw = st?.supplierName && (o.supplier === s.name || !o.supplier) ? st.supplierName : o.supplier ?? st?.supplierName ?? s.name;
  return resolveName(settings, raw)!;
}

/** Количество заказа: если не указано, но есть поставки — берём поставленное */
function itemQty(it: ParsedOrder["items"][number]) {
  const delivered = it.deliveries.reduce((a, d) => a + d.qty, 0);
  return it.qty ?? delivered;
}

export async function buildPreview(p: ParseResult, settings: ImportSettings): Promise<Preview> {
  const existingSup = new Set((await db.select({ key: schema.suppliers.key }).from(schema.suppliers)).map((r) => r.key));
  const existingProd = new Set((await db.select({ key: schema.products.key }).from(schema.products)).map((r) => r.key));
  const fps: string[] = [];
  const orders: PreviewOrder[] = [];
  const sup = new Set<string>(),
    prod = new Set<string>(),
    legal = new Set<string>();
  const sheets: Preview["sheets"] = [];
  const issues: Issue[] = [];
  let skippedRows = 0;
  for (const s of p.sheets) {
    const st = settings.sheets[s.name];
    const enabled = !!st?.enabled;
    const t = { amount: 0, qty: 0, delivered: 0, paid: 0 };
    for (const o of s.orders) {
      for (const it of o.items) {
        t.amount += (it.qty ?? 0) * (it.price ?? 0);
        t.qty += it.qty ?? 0;
        t.delivered += it.deliveries.reduce((a, d) => a + d.qty, 0);
      }
      t.paid += o.payments.reduce((a, x) => a + x.amount, 0);
    }
    sheets.push({
      name: s.name,
      kind: s.kind,
      enabled,
      duplicateOf: (s as ParsedSheet & { duplicateOf?: string }).duplicateOf,
      orders: s.orders.length,
      items: s.orders.reduce((a, o) => a + o.items.length, 0),
      deliveries: s.orders.reduce((a, o) => a + o.items.reduce((b, i) => b + i.deliveries.length, 0), 0),
      payments: s.orders.reduce((a, o) => a + o.payments.length, 0),
      supplierPayments: s.supplierPayments.length,
      plan: s.plan.length,
      skipped: s.skippedRows.length,
      totals: t,
      excel: s.excelTotals,
    });
    issues.push(...s.issues);
    if (!enabled) continue;
    skippedRows += s.skippedRows.length;
    for (const o of s.orders) {
      const supplier = supplierOf(s, o, settings);
      sup.add(normKey(supplier));
      if (o.legalEntity) legal.add(normKey(resolveName(settings, o.legalEntity)));
      for (const it of o.items) prod.add(normKey(resolveName(settings, it.product)));
      const fp = fingerprint(s.name, o, supplier);
      fps.push(fp);
      if (!o.items.length)
        issues.push({ level: "error", sheet: s.name, row: o.firstRow, code: "ORDER_NO_ITEMS", message: `Счёт № ${o.invoice ?? "б/н"}: есть оплаты (${o.payments.reduce((a, x) => a + x.amount, 0).toLocaleString("ru-RU")} ₽), но ни одной позиции с количеством. Заказ будет создан без позиций — дополните вручную.` });
      const items = o.items.map((it) => ({ id: "", qty: itemQty(it), delivered: it.deliveries.reduce((a, d) => a + d.qty, 0), isClosed: settings.closeManual && !!it.closedManually }));
      orders.push({
        sheet: s.name,
        rows: `${o.firstRow}–${o.lastRow}`,
        supplier,
        invoice: o.invoice,
        orderDate: o.orderDate,
        items: o.items.length,
        amount: o.items.reduce((a, i) => a + itemQty(i) * (i.price ?? 0), 0),
        qty: items.reduce((a, i) => a + i.qty, 0),
        delivered: items.reduce((a, i) => a + i.delivered, 0),
        paid: o.payments.reduce((a, x) => a + x.amount, 0),
        status: computeStatus("AWAITING", items),
        duplicateInDb: false,
        fp,
      });
    }
    for (const r of s.plan) {
      sup.add(normKey(resolveName(settings, r.supplier)));
      prod.add(normKey(resolveName(settings, r.product)));
    }
  }
  // повторный импорт: такие заказы уже есть в базе
  const dupSet = new Set<string>();
  if (fps.length) {
    const rows = await db.execute(sql`SELECT source FROM purchase_orders WHERE deleted_at IS NULL AND source LIKE 'import:%'`);
    for (const r of rows.rows as { source: string }[]) {
      const m = r.source.match(/#([0-9a-f]{16})$/);
      if (m) dupSet.add(m[1]);
    }
  }
  for (const o of orders) o.duplicateInDb = dupSet.has(o.fp);
  const enabledSheets = p.sheets.filter((s) => settings.sheets[s.name]?.enabled);
  return {
    sheets,
    counts: {
      suppliers: sup.size,
      newSuppliers: [...sup].filter((k) => !existingSup.has(k)).length,
      products: prod.size,
      newProducts: [...prod].filter((k) => !existingProd.has(k)).length,
      legal: legal.size,
      orders: orders.filter((o) => !o.duplicateInDb).length,
      items: orders.filter((o) => !o.duplicateInDb).reduce((a, o) => a + o.items, 0),
      deliveries: enabledSheets.reduce((a, s) => a + s.orders.reduce((b, o) => b + o.items.reduce((c, i) => c + i.deliveries.length, 0), 0), 0),
      payments: enabledSheets.reduce((a, s) => a + s.orders.reduce((b, o) => b + o.payments.length, 0) + (settings.supplierAdvances ? s.supplierPayments.length : 0), 0),
      plan: enabledSheets.reduce((a, s) => a + s.plan.length, 0),
      duplicatesInDb: orders.filter((o) => o.duplicateInDb).length,
      skippedRows,
    },
    issues,
    merges: suggestMerges(p, settings.sheets),
    orders,
  };
}

// ---------- выполнение ----------

/**
 * Направления — закрытый справочник (Настройки → Справочники): новые при импорте не создаются.
 * «ПП - Поля», «ПП-осн» → «ПП» по первому слову; не нашлось — направление остаётся пустым.
 */
async function matchDirection(tx: Tx, name: string | null | undefined, cache: Map<string, string | null>) {
  if (!name?.trim()) return null;
  const key = normKey(name);
  if (cache.has(key)) return cache.get(key)!;
  const all = await tx.select({ id: schema.directions.id, key: schema.directions.key }).from(schema.directions);
  const head = key.split(/[ -]/)[0];
  const id = all.find((d) => d.key === key)?.id ?? all.find((d) => d.key === head)?.id ?? null;
  cache.set(key, id);
  return id;
}

/** Наше юрлицо из Excel; название, совпадающее с направлением (например «Фитотрейд»), юрлицом не считается */
async function legalId(tx: Tx, name: string | null | undefined, cache: Map<string, string>) {
  if (!name?.trim()) return null;
  const [dir] = await tx.select({ id: schema.directions.id }).from(schema.directions).where(eq(schema.directions.key, normKey(name)));
  if (dir) return null;
  return upsertByKey(tx, "legal", name, cache);
}

async function upsertByKey(tx: Tx, table: "suppliers" | "legal", name: string, cache: Map<string, string>) {
  const key = normKey(name);
  if (cache.has(key)) return cache.get(key)!;
  const t = table === "suppliers" ? schema.suppliers : schema.legalEntities;
  const [ex] = await tx.select({ id: t.id }).from(t).where(eq(t.key, key));
  let id: string | undefined = ex?.id;
  // «ИП Елисеев Максим Анатолиевич», «Елисеев» и «ИП Елисеев Максим Анатольевич» — одно юрлицо (отчество в Excel пишут по-разному)
  const surname = table === "legal" ? (/^ип\s+(\S+)/.exec(key)?.[1] ?? null) : null;
  if (!id && table === "legal") {
    const legal = await tx.select({ id: schema.legalEntities.id, key: schema.legalEntities.key, short: schema.legalEntities.shortName }).from(schema.legalEntities);
    const names = (l: (typeof legal)[number]) => [l.short && normKey(l.short), /^ип\s+(\S+)/.exec(l.key)?.[1], l.key].filter(Boolean);
    id = legal.find((l) => names(l).some((n) => n === key || n === surname))?.id;
  }
  if (!id) {
    const v = table === "legal" ? { name: name.trim(), key, shortName: surname ? name.trim().split(/\s+/)[1] : null } : { name: name.trim(), key };
    const [c] = await tx.insert(t).values(v as never).returning({ id: t.id });
    id = c.id;
  }
  cache.set(key, id!);
  return id!;
}

async function productId(tx: Tx, name: string, cache: Map<string, string>, category?: string) {
  const key = normKey(name);
  if (cache.has(key)) return cache.get(key)!;
  const [ex] = await tx.select().from(schema.products).where(eq(schema.products.key, key)).limit(1);
  let id = ex ? ex.mergedIntoId ?? ex.id : undefined;
  if (!id) {
    const [c] = await tx.insert(schema.products).values({ name: name.trim(), key, category: category ?? null }).returning();
    id = c.id;
  }
  cache.set(key, id);
  return id;
}

const SERVICE_RE = /^(доставка|транспорт|услуг)/i;

export async function executeImport(p: ParseResult, settings: ImportSettings, batchId: string, userId: string) {
  const preview = await buildPreview(p, settings);
  const dups = new Set(preview.orders.filter((o) => o.duplicateInDb).map((o) => o.fp));
  const stats = { orders: 0, items: 0, deliveries: 0, payments: 0, advances: 0, plan: 0, skippedDuplicates: 0 };
  await db.transaction(async (tx) => {
    const supC = new Map<string, string>(),
      legC = new Map<string, string>(),
      dirC = new Map<string, string | null>(),
      prodC = new Map<string, string>();
    const orderIds: string[] = [];
    for (const s of p.sheets) {
      const st = settings.sheets[s.name];
      if (!st?.enabled) continue;
      for (const o of s.orders) {
        const supplier = supplierOf(s, o, settings);
        const fp = fingerprint(s.name, o, supplier);
        if (dups.has(fp)) {
          stats.skippedDuplicates++;
          continue;
        }
        const supplierId = await upsertByKey(tx, "suppliers", supplier, supC);
        if (st.buyerId) await tx.insert(schema.supplierBuyers).values({ supplierId, userId: st.buyerId, isPrimary: true }).onConflictDoNothing();
        const legalName = resolveName(settings, o.legalEntity);
        const legalEntityId = await legalId(tx, legalName, legC);
        const dirName = o.direction ?? o.items.find((i) => i.direction)?.direction ?? null;
        const directionId = await matchDirection(tx, dirName && resolveName(settings, dirName), dirC);
        const orderDate = o.orderDate ?? o.items.flatMap((i) => i.deliveries.map((d) => d.date)).filter(Boolean).sort()[0] ?? o.payments.map((x) => x.date).filter(Boolean).sort()[0] ?? new Date().toISOString().slice(0, 10);
        const notes: string[] = [];
        if (o.note) notes.push(o.note);
        if (!o.orderDate) notes.push("Дата заказа в Excel не указана — взята дата первой поставки/оплаты");
        if (!o.items.length) notes.push("В Excel у счёта нет позиций с количеством (только оплаты) — добавьте товары вручную");
        const [ord] = await tx
          .insert(schema.purchaseOrders)
          .values({
            orderDate: orderDate!,
            buyerId: st.buyerId ?? null,
            createdById: userId,
            supplierId,
            legalEntityId,
            directionId,
            invoiceNumber: o.invoice,
            invoiceDate: o.orderDate,
            plannedDeliveryDate: addDays(orderDate!, settings.leadDays),
            status: "AWAITING",
            comment: notes.join(". ") || null,
            source: `import:${s.name}!${o.firstRow}-${o.lastRow}#${fp}`,
            importBatchId: batchId,
          })
          .returning();
        orderIds.push(ord.id);
        stats.orders++;
        await tx.update(schema.suppliers).set({ startedAt: sql`LEAST(COALESCE(${schema.suppliers.startedAt}, ${orderDate}::date), ${orderDate}::date)` }).where(eq(schema.suppliers.id, supplierId));
        // поставки группируются в партии: заказ + дата
        const byDate = new Map<string, { itemId: string; productId: string; qty: number; price: number | null; cell: string; formula?: string; exclude: boolean }[]>();
        let sort = 0;
        for (const it of o.items) {
          const name = resolveName(settings, it.product)!;
          const pid = await productId(tx, name, prodC, SERVICE_RE.test(name) ? "Услуги" : undefined);
          await tx.insert(schema.productSuppliers).values({ productId: pid, supplierId }).onConflictDoNothing();
          const delivered = it.deliveries.reduce((a, d) => a + d.qty, 0);
          const qty = itemQty(it);
          const itemNotes: string[] = [`Excel: «${s.name}», стр. ${it.row}`];
          if (it.qty === null) itemNotes.push("кол-во заказа в Excel не указано — принято равным поставленному");
          const itemDir = it.direction && it.direction !== dirName ? ((await matchDirection(tx, resolveName(settings, it.direction), dirC)) ?? directionId) : directionId;
          const [poi] = await tx
            .insert(schema.purchaseOrderItems)
            .values({
              orderId: ord.id,
              productId: pid,
              directionId: itemDir,
              qty: String(qty),
              price: it.price === null ? null : String(it.price),
              isClosed: settings.closeManual && !!it.closedManually,
              closedNote: settings.closeManual && it.closedManually ? "Закрыта в Excel (остаток перезаписан вручную)" : null,
              overDeliveryApproved: delivered > qty,
              note: itemNotes.join("; "),
              sortOrder: sort++,
            })
            .returning();
          stats.items++;
          const simpleAssumed = s.kind === "simple";
          for (const d of it.deliveries) {
            if (s.kind === "simple" && !settings.assumeSimpleDeliveries) continue;
            const date = d.date ?? o.orderDate;
            if (!date) continue;
            const key = `${date}|${simpleAssumed && !d.date ? "a" : ""}`;
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key)!.push({ itemId: poi.id, productId: pid, qty: d.qty, price: it.price, cell: d.cell, formula: d.fromFormula, exclude: simpleAssumed && it.qty === null });
          }
        }
        for (const [key, lines] of byDate) {
          const [date, assumed] = key.split("|");
          const formulas = lines.filter((l) => l.formula).map((l) => `${l.cell}: =${l.formula}`);
          const [del] = await tx
            .insert(schema.deliveries)
            .values({
              orderId: ord.id,
              supplierId,
              date,
              dateAssumed: assumed === "a" || s.kind === "simple",
              comment: [`Импорт из Excel (${s.name})`, ...formulas].join("; "),
              importBatchId: batchId,
            })
            .returning();
          for (const l of lines) await tx.insert(schema.deliveryItems).values({ deliveryId: del.id, orderItemId: l.itemId, productId: l.productId, qty: String(l.qty), price: l.price === null ? null : String(l.price), excludeFromPrice: l.exclude, sourceCell: l.cell });
          stats.deliveries++;
        }
        for (const pay of o.payments) {
          const cash = /нал/i.test(pay.doc ?? "") || /нал/i.test(pay.note ?? "");
          await tx.insert(schema.payments).values({
            supplierId,
            orderId: ord.id,
            legalEntityId,
            type: pay.kind === "advance" || /предоплат|аванс/i.test(pay.note ?? "") ? "ADVANCE" : pay.kind === "final" ? "FULL" : "PARTIAL",
            method: cash ? "CASH" : "BANK",
            date: pay.date,
            amount: String(pay.amount),
            docNumber: cash ? null : pay.doc ?? null,
            comment: [pay.note, `Excel: «${s.name}», стр. ${pay.row}`, pay.date ? null : "дата не указана"].filter(Boolean).join("; "),
            importBatchId: batchId,
          });
          stats.payments++;
        }
      }
      if (settings.supplierAdvances) {
        for (const pay of s.supplierPayments) {
          const supplier = resolveName(settings, pay.supplier ?? st.supplierName ?? s.name)!;
          const supplierId = await upsertByKey(tx, "suppliers", supplier, supC);
          const legalName = resolveName(settings, pay.legalEntity);
          await tx.insert(schema.payments).values({
            supplierId,
            orderId: null,
            legalEntityId: await legalId(tx, legalName, legC),
            type: "ADVANCE",
            method: "BANK",
            date: pay.date,
            amount: String(pay.amount),
            comment: ["Аванс без привязки к счёту", pay.note, `Excel: «${s.name}», стр. ${pay.row}`, pay.date ? null : "дата не указана"].filter(Boolean).join("; "),
            importBatchId: batchId,
          });
          stats.advances++;
        }
      }
      for (const r of s.plan) {
        const supplierId = await upsertByKey(tx, "suppliers", resolveName(settings, r.supplier)!, supC);
        if (st.buyerId) await tx.insert(schema.supplierBuyers).values({ supplierId, userId: st.buyerId, isPrimary: true }).onConflictDoNothing();
        const pid = await productId(tx, resolveName(settings, r.product)!, prodC, "Приборы");
        await tx.insert(schema.productSuppliers).values({ productId: pid, supplierId }).onConflictDoNothing();
        const legalEntityId = await legalId(tx, resolveName(settings, r.legalEntity), legC);
        if (!r.weeks.length) {
          await tx.insert(schema.supplyPlanEntries).values({ supplierId, productId: pid, legalEntityId, status: r.status, note: r.note, importBatchId: batchId });
        }
        for (const w of r.weeks) await tx.insert(schema.supplyPlanEntries).values({ supplierId, productId: pid, legalEntityId, weekStart: w.date, qty: String(w.qty), status: r.status, note: r.note, importBatchId: batchId });
        stats.plan++;
        if (r.status && /не дают|закончились/i.test(r.status)) await tx.update(schema.suppliers).set({ status: "PAUSED" }).where(eq(schema.suppliers.id, supplierId));
      }
    }
    // статусы заказов по факту поставок
    if (orderIds.length) {
      const res = await tx.execute(sql`
        SELECT poi.id, poi.order_id, poi.qty, poi.is_closed, COALESCE(SUM(di.qty),0) AS delivered
        FROM purchase_order_items poi LEFT JOIN delivery_items di ON di.order_item_id = poi.id
        WHERE poi.order_id IN (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)}) GROUP BY poi.id`);
      const byOrder = new Map<string, { id: string; qty: number; delivered: number; isClosed: boolean }[]>();
      for (const r of res.rows as Record<string, unknown>[]) {
        const k = r.order_id as string;
        if (!byOrder.has(k)) byOrder.set(k, []);
        byOrder.get(k)!.push({ id: r.id as string, qty: Number(r.qty), delivered: Number(r.delivered), isClosed: r.is_closed as boolean });
      }
      const groups = new Map<string, string[]>();
      for (const [oid, items] of byOrder) {
        const st = computeStatus("AWAITING", items);
        if (!groups.has(st)) groups.set(st, []);
        groups.get(st)!.push(oid);
      }
      for (const [st, ids] of groups) await tx.update(schema.purchaseOrders).set({ status: st as "AWAITING" }).where(inArray(schema.purchaseOrders.id, ids));
    }
    await tx.update(schema.importBatches).set({ status: "done", summary: { ...stats, counts: preview.counts }, settings }).where(eq(schema.importBatches.id, batchId));
    await tx.insert(schema.activityLogs).values({
      userId,
      action: "import",
      entityType: "import",
      entityId: batchId,
      summary: `Импорт Excel «${p.fileName}»: заказов ${stats.orders}, позиций ${stats.items}, поставок ${stats.deliveries}, оплат ${stats.payments + stats.advances}, план ${stats.plan}${stats.skippedDuplicates ? `, пропущено дублей ${stats.skippedDuplicates}` : ""}`,
    });
  });
  return stats;
}

/** Откат импорта: удаляет все заказы, поставки, оплаты и план, созданные этим импортом */
export async function rollbackImport(batchId: string, userId: string) {
  await db.transaction(async (tx) => {
    const orders = await tx.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.importBatchId, batchId));
    const ids = orders.map((o) => o.id);
    // если по импортированным заказам уже вносили данные вручную — не удаляем молча
    if (ids.length) {
      const manual = await tx.execute(sql`
        SELECT (SELECT COUNT(*) FROM deliveries WHERE order_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND (import_batch_id IS NULL OR import_batch_id <> ${batchId}))::int AS d,
               (SELECT COUNT(*) FROM payments WHERE order_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND (import_batch_id IS NULL OR import_batch_id <> ${batchId}))::int AS p`);
      const m = manual.rows[0] as { d: number; p: number };
      if (m.d || m.p) throw new Error(`По импортированным заказам уже внесено вручную: поставок ${m.d}, оплат ${m.p}. Откат невозможен.`);
      await tx.delete(schema.tasks).where(inArray(schema.tasks.orderId, ids)).catch(() => undefined);
    }
    await tx.delete(schema.payments).where(eq(schema.payments.importBatchId, batchId));
    await tx.delete(schema.deliveries).where(eq(schema.deliveries.importBatchId, batchId));
    if (ids.length) await tx.delete(schema.purchaseOrders).where(inArray(schema.purchaseOrders.id, ids));
    await tx.delete(schema.supplyPlanEntries).where(eq(schema.supplyPlanEntries.importBatchId, batchId));
    await tx.update(schema.importBatches).set({ status: "rolled_back" }).where(eq(schema.importBatches.id, batchId));
    await tx.insert(schema.activityLogs).values({ userId, action: "rollback", entityType: "import", entityId: batchId, summary: `Импорт отменён: удалено заказов ${ids.length}` });
  });
}

void like;
