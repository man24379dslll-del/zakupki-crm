"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { logActivity } from "@/lib/audit";
import { fnum, fstr, safe, UserError } from "@/lib/forms";
import { putFile } from "@/lib/storage";
import { parseWorkbook, type ColumnMapping, type SheetKind } from "@/lib/import/parser";
import { defaultSettings, executeImport, rollbackImport } from "@/lib/import/importer";
import { loadImport, type StoredImport } from "@/lib/import/load";
import type { ActionResult } from "@/components/client";

export async function uploadImportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const u = await requirePerm(PERMS.importRun);
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) throw new UserError("Выберите файл Excel");
    if (!/\.xlsx$/i.test(f.name)) throw new UserError("Поддерживается формат .xlsx");
    if (f.size > 30 * 1024 * 1024) throw new UserError("Файл больше 30 МБ");
    const buf = Buffer.from(await f.arrayBuffer());
    const parsed = await parseWorkbook(buf, f.name).catch(() => {
      throw new UserError("Не удалось прочитать файл — проверьте, что это книга Excel .xlsx");
    });
    const file = await putFile(`imports/${randomUUID()}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const stored: StoredImport = { file, settings: defaultSettings(parsed), overrides: {} };
    const [b] = await db.insert(schema.importBatches).values({ fileName: f.name, createdById: u.id, status: "preview", settings: stored }).returning();
    id = b.id;
  });
  if (r && "error" in r) return r;
  redirect(`/settings/import/${id}`);
}

const LETTER = /^[A-Z]{1,3}$/;
function colNum(s: string) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export async function saveImportSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    await requirePerm(PERMS.importRun);
    const id = String(fd.get("id"));
    const [b] = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, id));
    if (!b || b.status !== "preview") throw new UserError("Импорт уже выполнен или не найден");
    const st = b.settings as StoredImport;
    for (const name of Object.keys(st.settings.sheets)) {
      const k = Buffer.from(name).toString("hex");
      st.settings.sheets[name] = {
        enabled: fd.get(`en_${k}`) === "on",
        buyerId: fstr(fd.get(`buyer_${k}`)),
        supplierName: fstr(fd.get(`sup_${k}`)),
      };
      // сопоставление столбцов: буквы колонок
      const mapping: ColumnMapping = { ...(st.overrides[name]?.mapping ?? {}) };
      let touched = false;
      for (const [key, v] of fd.entries()) {
        if (!key.startsWith(`map_${k}_`)) continue;
        const field = key.slice(`map_${k}_`.length) as keyof ColumnMapping;
        const s = String(v).trim().toUpperCase();
        if (!s) continue;
        if (!LETTER.test(s)) throw new UserError(`Лист «${name}»: «${s}» — не буква столбца`);
        mapping[field] = colNum(s);
        touched = true;
      }
      const hr = fnum(fd.get(`hr_${k}`));
      const kind = fstr(fd.get(`kind_${k}`)) as SheetKind | null;
      if (touched || hr || kind) st.overrides[name] = { ...(st.overrides[name] ?? {}), ...(touched ? { mapping } : {}), ...(hr ? { headerRow: hr } : {}), ...(kind ? { kind } : {}) };
    }
    st.settings.merges = {};
    for (const v of fd.getAll("merge")) {
      const [from, to] = JSON.parse(String(v)) as [string, string];
      st.settings.merges[from] = to;
    }
    st.settings.leadDays = Math.max(0, Math.min(365, fnum(fd.get("leadDays")) ?? 30));
    st.settings.closeManual = fd.get("closeManual") === "on";
    st.settings.supplierAdvances = fd.get("supplierAdvances") === "on";
    st.settings.assumeSimpleDeliveries = fd.get("assumeSimpleDeliveries") === "on";
    await db.update(schema.importBatches).set({ settings: st }).where(eq(schema.importBatches.id, id));
    revalidatePath(`/settings/import/${id}`);
    return { ok: "Настройки применены, предпросмотр пересчитан" };
  });
}

export async function runImportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.importRun);
    const id = String(fd.get("id"));
    const { batch, stored, parsed } = await loadImport(id);
    if (batch.status !== "preview") throw new UserError("Этот импорт уже выполнен");
    if (!fd.get("agree")) throw new UserError("Подтвердите, что проверили предпросмотр");
    const stats = await executeImport(parsed, stored.settings, id, u.id);
    await db.update(schema.importBatches).set({ settings: stored }).where(eq(schema.importBatches.id, id));
    revalidatePath(`/settings/import/${id}`);
    return { ok: `Импорт выполнен: заказов ${stats.orders}, позиций ${stats.items}, поставок ${stats.deliveries}, оплат ${stats.payments + stats.advances}, строк плана ${stats.plan}${stats.skippedDuplicates ? `, пропущено уже загруженных ${stats.skippedDuplicates}` : ""}.` };
  });
}

export async function rollbackImportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.importRun);
    try {
      await rollbackImport(String(fd.get("id")), u.id);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    revalidatePath("/settings");
    return { ok: "Импорт отменён" };
  });
}

export async function saveSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.settingsEdit);
    const mode = fd.get("priceWindowMode") === "calendar" ? "calendar" : "rolling";
    const lead = Math.max(0, Math.min(365, fnum(fd.get("defaultLeadDays")) ?? 30));
    for (const [key, value] of [["priceWindowMode", mode], ["defaultLeadDays", lead]] as const)
      await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
    await logActivity(db, { userId: u.id, action: "update", entityType: "settings", entityId: "global", summary: `Настройки: окно цен «${mode === "calendar" ? "6 полных месяцев" : "скользящие 6 месяцев"}», срок поставки по умолчанию ${lead} дн.` });
    revalidatePath("/settings");
    return { ok: "Сохранено" };
  });
}

export async function restoreRecordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.deleteRecords);
    const type = String(fd.get("type"));
    const id = String(fd.get("id"));
    const t = { order: schema.purchaseOrders, supplier: schema.suppliers, delivery: schema.deliveries, payment: schema.payments }[type];
    if (!t) throw new UserError("Неверный тип");
    await db.update(t).set({ deletedAt: null } as never).where(eq(t.id, id));
    if (type === "delivery") {
      const [d] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, id));
      const { recalcOrderStatus } = await import("@/lib/services/orders");
      await db.transaction((tx) => recalcOrderStatus(tx, d.orderId).then(() => undefined));
    }
    await logActivity(db, { userId: u.id, action: "restore", entityType: type, entityId: id, summary: "Запись восстановлена из удалённых" });
    revalidatePath("/settings");
    return { ok: "Восстановлено" };
  });
}
