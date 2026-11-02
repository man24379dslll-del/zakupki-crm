import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { assertEntityAccess } from "@/lib/services/documents";
import { getFile } from "@/lib/storage";

/** Скачивание документа — только после проверки доступа к объекту, к которому он прикреплён */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Требуется вход", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Не найдено", { status: 404 });
  const [d] = await db.select().from(schema.documents).where(and(eq(schema.documents.id, id), isNull(schema.documents.deletedAt)));
  if (!d) return new Response("Не найдено", { status: 404 });
  try {
    await assertEntityAccess(u, d.entityType, d.entityId);
  } catch {
    return new Response("Нет доступа", { status: 403 });
  }
  const buf = await getFile(d.storagePath);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": d.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
