import { AccessError } from "./auth";

/** Число из формы: «1 234,5» → 1234.5; пусто → null */
export function fnum(v: FormDataEntryValue | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export function fstr(v: FormDataEntryValue | null | undefined): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
}
export function fdate(v: FormDataEntryValue | null | undefined): string | null {
  const s = fstr(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export class UserError extends Error {}

/** Обёртка серверного действия: понятные ошибки вместо падения страницы */
export async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError || e instanceof AccessError) return { error: e.message };
    // redirect() бросает специальную ошибку — пробрасываем
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { error: "Не удалось сохранить: внутренняя ошибка. Данные не изменены." };
  }
}
