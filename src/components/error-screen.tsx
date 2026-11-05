"use client";
import { useEffect } from "react";

/**
 * Ошибки после выкладки новой версии: открытая до обновления страница обращается к старым
 * серверным действиям или файлам («Failed to find Server Action», ChunkLoadError).
 * Такую страницу достаточно перезагрузить — делаем это сами, но не чаще раза в 30 секунд, чтобы не зациклиться.
 */
const STALE = /server action|failed to find|chunkloaderror|loading chunk|dynamically imported module|deployment/i;
const KEY = "crm-stale-reload";

export function isStaleVersionError(e: unknown) {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? "");
  return STALE.test(s);
}

export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const stale = isStaleVersionError(error);
  useEffect(() => {
    console.error(error);
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // без sessionStorage просто перезагружаем — повторная ошибка покажет кнопку
    }
    window.location.reload();
  }, [error, stale]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{stale ? "Программа обновилась" : "Что-то пошло не так"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {stale
            ? "Пока страница была открыта, вышла новая версия. Обновляем страницу — введённые данные, возможно, придётся заполнить ещё раз."
            : "Страница не открылась из-за ошибки. Попробуйте обновить её. Если не поможет — сообщите руководителю, что вы делали перед ошибкой."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Обновить страницу
          </button>
          {reset && !stale && (
            <button type="button" onClick={() => reset()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Попробовать ещё раз
            </button>
          )}
        </div>
        {error.digest && <p className="mt-3 text-xs text-slate-400">Код ошибки: {error.digest}</p>}
      </div>
    </div>
  );
}
