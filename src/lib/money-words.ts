/** Сумма прописью для актов: 378852 → «Триста семьдесят восемь тысяч восемьсот пятьдесят два рубля 00 копеек» */
const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

/** форма слова по числу: 1 рубль, 2 рубля, 5 рублей */
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function triad(n: number, female: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((female ? ONES_F : ONES_M)[o]);
  }
  return out;
}

const SCALES: [string, string, string, boolean][] = [
  ["", "", "", false],
  ["тысяча", "тысячи", "тысяч", true],
  ["миллион", "миллиона", "миллионов", false],
  ["миллиард", "миллиарда", "миллиардов", false],
];

/** Целое число словами (рубли — мужской род) */
export function numberInWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "ноль";
  const parts: string[] = [];
  for (let i = SCALES.length - 1; i >= 0; i--) {
    const div = 1000 ** i;
    const chunk = Math.floor(n / div) % 1000;
    if (!chunk) continue;
    const [one, few, many, female] = SCALES[i];
    parts.push(...triad(chunk, female));
    if (i > 0) parts.push(plural(chunk, one, few, many));
  }
  return parts.join(" ");
}

export function rublesInWords(amount: number): string {
  const kop = Math.round(Math.abs(amount) * 100);
  const rub = Math.floor(kop / 100);
  const k = kop % 100;
  const words = numberInWords(rub);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${plural(rub, "рубль", "рубля", "рублей")} ${String(k).padStart(2, "0")} ${plural(k, "копейка", "копейки", "копеек")}`;
}
