import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Combobox, type ComboOption } from "./combobox";

export const cn = clsx;

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-slate-500 hover:text-slate-800">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-rose-50 text-rose-700",
  violet: "bg-violet-50 text-violet-700",
  cyan: "bg-cyan-50 text-cyan-800",
};
export function Badge({ tone = "gray", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone] ?? tones.gray)}>
      {children}
    </span>
  );
}

const btn = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-white text-rose-700 border border-rose-200 hover:bg-rose-50",
};
export type BtnVariant = keyof typeof btn;
export const btnClass = (v: BtnVariant = "secondary", size: "sm" | "md" = "md") =>
  cn("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none", btn[v], size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm");

export function LinkButton({ href, children, variant = "secondary", size = "md" }: { href: string; children: ReactNode; variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <Link href={href} className={btnClass(variant, size)}>
      {children}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50";

export function Field({ label, children, hint, className, required }: { label: string; children: ReactNode; hint?: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(inputClass, props.className)} />;
}
/** searchable — список с поиском по мере ввода (для справочников: поставщики, товары, юрлица…); короткие перечни — обычный select */
export function Select({
  options,
  placeholder,
  searchable,
  createPrefix,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: ComboOption[]; placeholder?: string; searchable?: boolean; createPrefix?: string }) {
  if (searchable)
    return (
      <Combobox
        name={props.name!}
        options={options}
        defaultValue={props.defaultValue === undefined ? "" : String(props.defaultValue)}
        placeholder={placeholder}
        required={props.required}
        disabled={props.disabled}
        createPrefix={createPrefix}
        className={props.className}
        inputClassName="py-2"
      />
    );
  return (
    <select {...props} className={cn(inputClass, "pr-8", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cn("whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", right && "text-right", className)}>{children}</th>;
}
export function Td({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-slate-100 px-3 py-2 align-top text-slate-700", right && "whitespace-nowrap text-right tabular-nums", className)}>
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Progress({ value, tone = "brand" }: { value: number; tone?: "brand" | "green" | "amber" | "red" }) {
  const v = Math.max(0, Math.min(100, value));
  const c = { brand: "bg-brand-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" }[tone];
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", c)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "red" | "amber" | "green" }) {
  const body = (
    <div
      className={cn(
        "h-full rounded-xl border bg-white p-4 shadow-sm transition",
        tone === "red" ? "border-rose-200" : tone === "amber" ? "border-amber-200" : "border-slate-200",
        href && "hover:border-brand-500 hover:shadow",
      )}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums xl:text-[22px]", tone === "red" ? "text-rose-600" : "text-slate-900")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Вкладки как ссылки (?tab=...) — работают без JS и сохраняются в адресе */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string; count?: number }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          scroll={false}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            current === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Alert({ tone = "amber", children }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode }) {
  const c = { amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-rose-200 bg-rose-50 text-rose-800", blue: "border-blue-200 bg-blue-50 text-blue-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={cn("rounded-lg border px-3 py-2 text-sm", c)}>{children}</div>;
}
