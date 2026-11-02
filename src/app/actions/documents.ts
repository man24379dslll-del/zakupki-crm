"use server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { safe, UserError } from "@/lib/forms";
import { assertEntityAccess, entityPath } from "@/lib/services/documents";
import { putFile } from "@/lib/storage";
import { can, PERMS } from "@/lib/permissions";
import type { ActionResult } from "@/components/client";

const MAX = 20 * 1024 * 1024;
const ALLOWED = /\.(pdf|jpe?g|png|webp|heic|docx?|xlsx?|csv|txt|zip|rar|7z|odt|ods)$/i;

export async function uploadDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    if (u.role === "VIEWER") throw new UserError("Наблюдатель не может загружать документы");
    const entityType = String(fd.get("entityType"));
    const entityId = String(fd.get("entityId"));
    await assertEntityAccess(u, entityType, entityId, true);
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new UserError("Выберите файл");
    for (const f of files) {
      if (f.size > MAX) throw new UserError(`«${f.name}» больше 20 МБ`);
      if (!ALLOWED.test(f.name)) throw new UserError(`Тип файла «${f.name}» не поддерживается`);
      const key = `${entityType}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${path.extname(f.name).toLowerCase()}`;
      const stored = await putFile(key, Buffer.from(await f.arrayBuffer()), f.type);
      const [doc] = await db.insert(schema.documents).values({ entityType, entityId, fileName: f.name, mimeType: f.type || "application/octet-stream", size: f.size, storagePath: stored, uploadedById: u.id }).returning();
      await logActivity(db, { userId: u.id, action: "upload", entityType, entityId, summary: `Загружен документ «${f.name}»` });
      void doc;
    }
    revalidatePath(entityPath(entityType, entityId));
    return { ok: "Загружено" };
  });
}

export async function deleteDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    const [d] = await db.select().from(schema.documents).where(eq(schema.documents.id, String(fd.get("id"))));
    if (!d) throw new UserError("Документ не найден");
    await assertEntityAccess(u, d.entityType, d.entityId, true);
    if (d.uploadedById !== u.id && !can(u, PERMS.deleteRecords)) throw new UserError("Удалить можно только свой документ");
    await db.update(schema.documents).set({ deletedAt: new Date() }).where(eq(schema.documents.id, d.id));
    await logActivity(db, { userId: u.id, action: "delete", entityType: d.entityType, entityId: d.entityId, summary: `Удалён документ «${d.fileName}»` });
    revalidatePath(entityPath(d.entityType, d.entityId));
  });
}
