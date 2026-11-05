import Link from "next/link";
import type { ReactNode } from "react";
import { btnClass, cn } from "./ui";
import { Combobox, type ComboOption } from "./combobox";

export type SP = Record<string, string | string[] | undefined>;

export function qp(sp: SP, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function withQuery(base: string, sp: SP, patch: Record<string, string | number | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) q.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function pageParams(sp: SP, size = 50) {
  const page = Math.max(1, Number(qp(sp, "page")) || 1);
  return { page, limit: size, offset: (page - 1) * size };
}

/** Фильтры: обычная GET-форма, состояние хранится в адресе (можно сохранить вид или отправить ссылку) */
export function FilterBar({ children, base, sp, keep = [] }: { children: ReactNode; base: string; sp: SP; keep?: string[] }) {
  return (
    <form method="get" action={base} className="mb-3 flex flex-wrap items-end gap-2">
      {keep.map((k) => (qp(sp, k) ? <input key={k} type="hidden" name={k} value={qp(sp, k)} /> : null))}
      {children}
      <button type="submit" className={btnClass("secondary", "sm")}>
        Применить
      </button>
      <Link href={base} className={btnClass("ghost", "sm")}>
        Сбросить
      </Link>
    </form>
  );
}

export function SearchInput({ sp, placeholder = "Поиск…" }: { sp: SP; placeholder?: string }) {
  return (
    <input
      name="q"
      defaultValue={qp(sp, "q")}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none sm:w-64"
    />
  );
}

export function FSelect({ name, sp, options, placeholder, className, searchable }: { name: string; sp: SP; options: ComboOption[]; placeholder: string; className?: string; searchable?: boolean }) {
  if (searchable) return <Combobox name={name} options={options} defaultValue={qp(sp, name)} placeholder={placeholder} className={className ?? "w-full sm:w-56"} />;
  return (
    <select name={name} defaultValue={qp(sp, name)} className={cn("rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm", className)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FDate({ name, sp, label }: { name: string; sp: SP; label: string }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <input type="date" name={name} defaultValue={qp(sp, name)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800" />
    </label>
  );
}

export function SortTh({ label, field, base, sp, right, def }: { label: string; field: string; base: string; sp: SP; right?: boolean; def?: boolean }) {
  const cur = qp(sp, "sort") || (def ? field : "");
  const dir = qp(sp, "dir") || "desc";
  const active = cur === field;
  const next = active && dir === "desc" ? "asc" : "desc";
  return (
    <th className={cn("whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", right && "text-right")}>
      <Link href={withQuery(base, sp, { sort: field, dir: next, page: null })} className="hover:text-slate-900">
        {label}
        {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
      </Link>
    </th>
  );
}

export function Pagination({ base, sp, total, page, size }: { base: string; sp: SP; total: number; page: number; size: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between px-3 py-3 text-sm text-slate-500">
      <span>
        Всего: <b className="text-slate-700">{total}</b>
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          {page > 1 && (
            <Link className={btnClass("secondary", "sm")} href={withQuery(base, sp, { page: page - 1 })}>
              ←
            </Link>
          )}
          <span className="px-2">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link className={btnClass("secondary", "sm")} href={withQuery(base, sp, { page: page + 1 })}>
              →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function ExportLink({ entity, sp }: { entity: string; sp: SP }) {
  return (
    <a href={withQuery(`/api/export/${entity}`, sp, { page: null })} className={btnClass("secondary", "sm")}>
      ⬇ Excel
    </a>
  );
}

export function SavedViews({ views, base }: { views: { id: string; name: string; query: string }[]; base: string }) {
  if (!views.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
      <span className="text-slate-500">Мои виды:</span>
      {views.map((v) => (
        <Link key={v.id} href={`${base}?${v.query}`} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700 hover:border-brand-500">
          {v.name}
        </Link>
      ))}
    </div>
  );
}
