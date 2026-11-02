"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const mLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const COLORS = ["#2856e0", "#e0702a", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];
const rub = (v: number) => `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

/** Помесячная средневзвешенная цена (общая + по поставщикам) */
export function PriceChart({ data, series }: { data: Record<string, string | number | null>[]; series: { key: string; name: string }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="month" tickFormatter={mLabel} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={56} domain={["auto", "auto"]} />
          <Tooltip formatter={(v) => rub(Number(v))} labelFormatter={(l) => mLabel(String(l))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={i === 0 ? 2.5 : 1.5} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MoneyBars({ data, xKey, bars }: { data: Record<string, string | number>[]; xKey: string; bars: { key: string; name: string }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={(v) => (/^\d{4}-\d{2}$/.test(String(v)) ? mLabel(String(v)) : String(v))} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => `${(Number(v) / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`} />
          <Tooltip formatter={(v) => rub(Number(v))} labelFormatter={(l) => (/^\d{4}-\d{2}$/.test(String(l)) ? mLabel(String(l)) : String(l))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} name={b.name} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
