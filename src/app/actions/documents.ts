"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { safe, UserError } from "@/lib/forms";
import { assertEntityAccess, entityPath } from "@/lib/services/documents";
import { formFiles, saveUploadedFiles } from "@/lib/services/contracts";
import { can, PERMS } from "@/lib/permissions";
import type { ActionResult } from "@/components/client";


export async function uploadDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requireUser();
    if (u.role === "VIEWER") throw new UserError("Наблюдатель не может загружать документы");
    const entityType = String(fd.get("entityType"));
    const entityId = String(fd.get("entityId"));
    await assertEntityAccess(u, entityType, entityId, true);
    const files = formFiles(fd);
    if (!files.length) throw new UserError("Выберите файл");
    await saveUploadedFiles(db, entityType, entityId, files, u.id);
    revalidatePath(await entityPath(entityType, entityId));
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
    revalidatePath(await entityPath(d.entityType, d.entityId));
  });
}
