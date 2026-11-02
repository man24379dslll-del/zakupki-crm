/**
 * Нормализованный ключ для поиска дублей: регистр, ё/е, кавычки, пробелы и дефисы не важны.
 * «ИП ТЕСЛОВА ВАЛЕРИЯ ЮРЬЕВНА» == «ИП Теслова Валерия Юрьевна», «ПП - Поля» == «ПП-поля».
 */
export function normKey(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'«»“”„`]/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/[\s.,]+/g, " ")
    .trim();
}

/** Расстояние Левенштейна — для подсказок «возможно, это тот же товар/поставщик» */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Похожи ли строки: совпадает ключ, одна содержит другую, или отличие ≤ 2 символов при длине ≥ 6 */
export function isSimilar(a: string, b: string): boolean {
  const ka = normKey(a),
    kb = normKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const short = ka.length < kb.length ? ka : kb;
  const long = ka.length < kb.length ? kb : ka;
  if (short.length >= 5 && long.startsWith(short + " ")) return true;
  if (short.length >= 6 && levenshtein(ka, kb) <= 2) return true;
  return false;
}
