import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, ConfirmButton, SubmitButton } from "./client";
import { Card, Empty, Textarea } from "./ui";
import { LogEntry } from "./log-entry";
import { loadLogDetails } from "@/lib/services/log-details";
import { deleteDocumentAction, uploadDocumentAction } from "@/app/actions/documents";
import { addCommentAction } from "@/app/(app)/orders/actions";

export async function DocumentsBlock({ entityType, entityId, canEdit, title = "Документы" }: { entityType: string; entityId: string; canEdit: boolean; title?: string }) {
  const docs = await db
    .select({ d: schema.documents, who: schema.users.name })
    .from(schema.documents)
    .innerJoin(schema.users, eq(schema.users.id, schema.documents.uploadedById))
    .where(and(eq(schema.documents.entityType, entityType), eq(schema.documents.entityId, entityId), isNull(schema.documents.deletedAt)))
    .orderBy(desc(schema.documents.createdAt));
  return (
    <Card title={`${title} (${docs.length})`}>
      {docs.length === 0 && <p className="mb-3 text-sm text-slate-500">Файлов нет</p>}
      <ul className="mb-3 space-y-1.5">
        {docs.map(({ d, who }) => (
          <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <a href={`/api/documents/${d.id}`} className="truncate text-brand-700 hover:underline" target="_blank">
              📄 {d.fileName}
            </a>
            <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
              {who}, {fmtDateTime(d.createdAt)}
              {canEdit && (
                <ConfirmButton action={deleteDocumentAction} question="Удалить файл?" hidden={{ id: d.id }}>
                  ✕
                </ConfirmButton>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <ActionForm action={uploadDocumentAction} resetOnOk className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="file" name="file" multiple className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
          <SubmitButton size="sm" variant="secondary">
            Загрузить
          </SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}

export async function CommentsBlock({ entityType, entityId, canEdit }: { entityType: "order" | "supplier"; entityId: string; canEdit: boolean }) {
  const rows = await db
    .select({ c: schema.comments, who: schema.users.name })
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
    .where(and(eq(schema.comments.entityType, entityType), eq(schema.comments.entityId, entityId)))
    .orderBy(desc(schema.comments.createdAt));
  return (
    <Card title={`Комментарии (${rows.length})`}>
      {canEdit && (
        <ActionForm action={addCommentAction} resetOnOk className="mb-4">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <Textarea name="text" rows={2} placeholder="Написать комментарий…" required />
          <div className="mt-2">
            <SubmitButton size="sm">Добавить</SubmitButton>
          </div>
        </ActionForm>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Комментариев пока нет</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ c, who }) => (
            <li key={c.id} className="text-sm">
              <div className="text-xs text-slate-500">
                <b className="text-slate-700">{who}</b> · {fmtDateTime(c.createdAt)}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-slate-800">{c.text}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ChangesView({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== "object") return null;
  const entries = Object.entries(changes as Record<string, unknown>);
  if (!entries.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
      {entries.map(([k, v]) =>
        // обычно [было, стало]; одиночное значение (например, «перенесено заказов») — просто показываем
        Array.isArray(v) ? (
          <li key={k}>
            {k}: <span className="text-rose-600 line-through">{String(v[0] ?? "—")}</span> → <span className="text-emerald-700">{String(v[1] ?? "—")}</span>
          </li>
        ) : (
          <li key={k}>
            {k}: <span className="text-slate-700">{String(v ?? "—")}</span>
          </li>
        ),
      )}
    </ul>
  );
}

export async function HistoryBlock({ entityType, entityId, limit = 50 }: { entityType: string; entityId: string; limit?: number }) {
  const rows = await db
    .select({ l: schema.activityLogs, who: schema.users.name })
    .from(schema.activityLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.activityLogs.userId))
    .where(and(eq(schema.activityLogs.entityType, entityType), eq(schema.activityLogs.entityId, entityId)))
    .orderBy(desc(schema.activityLogs.createdAt))
    .limit(limit);
  const details = await loadLogDetails(rows.map((r) => r.l.id));
  return (
    <Card title="История изменений">
      {rows.length === 0 ? (
        <Empty>Изменений нет</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ l, who }) => (
            <li key={l.id} className="text-sm">
              <div className="text-xs text-slate-500">
                {fmtDateTime(l.createdAt)} · <b className="text-slate-700">{who ?? "система"}</b>
              </div>
              <LogEntry summary={l.summary} detail={details.get(l.id)} />
              <ChangesView changes={l.changes} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
