"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";

export type ComboOption = { value: string; label: string; hint?: string | null };

/** Для поиска: регистр, ё/е, кавычки и лишние пробелы не важны */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'«»“”„`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const MAX_SHOWN = 60;

/**
 * Выпадающий список с поиском: печатаете часть названия (или ИНН, артикул — из подсказки) и выбираете из совпадений.
 * В форму уходит скрытое поле name со значением (id). Режимы:
 *  - free: можно оставить любой текст (новый товар) — в форму уходит сам текст;
 *  - createPrefix: пункт «+ Добавить «…»», в форму уходит createPrefix + текст (сервер создаёт запись).
 */
export function Combobox({
  name,
  options,
  defaultValue = "",
  placeholder,
  required,
  disabled,
  free,
  createPrefix,
  createLabel = "Добавить",
  autoSubmit,
  className,
  inputClassName,
}: {
  name: string;
  options: ComboOption[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  free?: boolean;
  createPrefix?: string;
  createLabel?: string;
  autoSubmit?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const labelOf = (v: string) => (free ? v : (options.find((o) => o.value === v)?.label ?? (v ? "(скрыто)" : "")));
  const [value, setValue] = useState(defaultValue);
  const [text, setText] = useState(() => labelOf(defaultValue));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // сброс формы (после успешного сохранения) возвращает исходное значение
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setValue(defaultValue);
      setText(labelOf(defaultValue));
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const indexed = useMemo(() => options.map((o) => ({ o, key: norm(`${o.label} ${o.hint ?? ""}`), lab: norm(o.label) })), [options]);
  const q = norm(typed ? text : "");
  const matches = useMemo(() => {
    if (!q) return indexed.map((x) => x.o);
    const words = q.split(" ");
    return indexed
      .filter((x) => words.every((w) => x.key.includes(w)))
      .sort((a, b) => Number(!a.lab.startsWith(q)) - Number(!b.lab.startsWith(q)))
      .map((x) => x.o);
  }, [indexed, q]);
  const exact = q ? indexed.find((x) => x.lab === q)?.o : undefined;
  const canCreate = !!createPrefix && !!q && !exact;
  const items: { kind: "clear" | "opt" | "create"; o?: ComboOption }[] = [
    ...(placeholder !== undefined && !required && !q ? [{ kind: "clear" as const }] : []),
    ...matches.slice(0, MAX_SHOWN).map((o) => ({ kind: "opt" as const, o })),
    ...(canCreate ? [{ kind: "create" as const }] : []),
  ];

  function commit(v: string, label: string) {
    setValue(v);
    setText(label);
    setTyped(false);
    setOpen(false);
    if (autoSubmit && v !== value) setTimeout(() => hiddenRef.current?.form?.requestSubmit(), 0);
  }
  function choose(i: number) {
    const it = items[i];
    if (!it) return;
    if (it.kind === "clear") commit("", "");
    else if (it.kind === "create") commit(`${createPrefix}${text.trim()}`, text.trim());
    else commit(free ? it.o!.label : it.o!.value, it.o!.label);
  }
  function leave() {
    if (!open && !typed) return;
    const t = text.trim();
    if (!t) commit("", "");
    else if (exact) commit(free ? exact.label : exact.value, exact.label);
    else if (free) commit(t, t);
    else if (createPrefix && value.startsWith(createPrefix)) setOpen(false);
    else {
      // набранный текст не совпал ни с одним вариантом — возвращаем выбранное ранее
      setText(labelOf(value));
      setTyped(false);
      setOpen(false);
    }
  }

  return (
    <div className={clsx("relative", className)}>
      <input type="hidden" ref={hiddenRef} name={name} value={value} />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        required={required}
        value={text}
        placeholder={placeholder ?? "Начните вводить…"}
        onFocus={(e) => {
          e.currentTarget.select();
          setActive(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
          if (free) setValue(e.target.value);
        }}
        onBlur={leave}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (items.length) choose(Math.min(active, items.length - 1));
            else leave();
          } else if (e.key === "Escape") {
            setText(labelOf(value));
            setTyped(false);
            setOpen(false);
          }
        }}
        className={clsx(
          "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 pr-7 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none disabled:bg-slate-50",
          inputClassName,
        )}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">▼</span>
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 z-50 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {items.length === 0 && <li className="px-3 py-2 text-slate-400">Ничего не найдено</li>}
          {items.map((it, i) => (
            <li
              key={it.kind === "opt" ? it.o!.value : it.kind}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={clsx("cursor-pointer px-3 py-1.5", i === active ? "bg-brand-50 text-brand-900" : "text-slate-700", it.kind === "opt" && !free && it.o!.value === value && "font-semibold")}
            >
              {it.kind === "clear" && <span className="text-slate-500">{placeholder || "—"}</span>}
              {it.kind === "create" && (
                <span className="font-medium text-brand-700">
                  + {createLabel} «{text.trim()}»
                </span>
              )}
              {it.kind === "opt" && (
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{it.o!.label}</span>
                  {it.o!.hint && <span className="shrink-0 truncate text-xs text-slate-400">{it.o!.hint}</span>}
                </span>
              )}
            </li>
          ))}
          {matches.length > MAX_SHOWN && <li className="px-3 py-1.5 text-xs text-slate-400">Показаны первые {MAX_SHOWN} из {matches.length} — уточните запрос</li>}
        </ul>
      )}
    </div>
  );
}
