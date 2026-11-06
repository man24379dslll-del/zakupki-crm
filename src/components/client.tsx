"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { btnClass, cn, type BtnVariant } from "./ui";
import { Combobox } from "./combobox";
import { TASK_STEPS, type TaskStep } from "@/lib/task-flow";

export type ActionResult = { error?: string; ok?: string; needConfirm?: string } | undefined | void;
export type FormAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Признак отправки формы (ActionForm отправляет вручную, чтобы React не очищал поля) */
const PendingCtx = createContext(false);

export function SubmitButton({ children, variant = "primary", size = "md", name, value, className }: { children: ReactNode; variant?: BtnVariant; size?: "sm" | "md"; name?: string; value?: string; className?: string }) {
  const status = useFormStatus();
  const ctx = useContext(PendingCtx);
  const pending = status.pending || ctx;
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cn(btnClass(variant, size), className)}>
      {pending ? "Сохранение…" : children}
    </button>
  );
}

/**
 * Форма с серверным действием: показывает ошибку/успех, поддерживает
 * «требуется подтверждение» (например, поставка сверх заказа).
 */
export function ActionForm({ action, children, className, resetOnOk, confirmField = "confirm" }: { action: FormAction; children: ReactNode; className?: string; resetOnOk?: boolean; confirmField?: string }) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && "ok" in state && state.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);
  const s = state || undefined;
  return (
    <PendingCtx.Provider value={isPending}>
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        // ручная отправка: введённые значения сохраняются при ошибке и при запросе подтверждения
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      {s?.error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{s.error}</div>}
      {s?.needConfirm && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div>{s.needConfirm}</div>
          <button type="submit" name={confirmField} value="1" className={cn(btnClass("primary", "sm"), "mt-2")}>
            Подтвердить и сохранить
          </button>
        </div>
      )}
      {s?.ok && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{s.ok}</div>}
    </form>
    </PendingCtx.Provider>
  );
}

/** Кнопка с подтверждением (защита от случайного удаления/отмены) */
export function ConfirmButton({ action, children, question, variant = "danger", size = "sm", hidden }: { action: FormAction; children: ReactNode; question: string; variant?: BtnVariant; size?: "sm" | "md"; hidden?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, undefined);
  if (!open)
    return (
      <span className="inline-flex flex-col">
        <button type="button" className={btnClass(variant, size)} onClick={() => setOpen(true)}>
          {children}
        </button>
        {state && "error" in state && state.error ? <span className="mt-1 text-xs text-rose-700">{state.error}</span> : null}
      </span>
    );
  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <span>{question}</span>
      <SubmitButton variant={variant === "danger" ? "danger" : "primary"} size="sm">
        Да
      </SubmitButton>
      <button type="button" className={btnClass("ghost", "sm")} onClick={() => setOpen(false)}>
        Нет
      </button>
    </form>
  );
}

/** Автоматическая отправка фильтров при изменении select */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const { options, placeholder, ...rest } = props;
  return (
    <select
      {...rest}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Сохранить текущие фильтры как представление */
export function SaveViewButton({ action, page }: { action: FormAction; page: string }) {
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, undefined);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnClass("ghost", "sm")}>
        ☆ Сохранить вид
      </button>
    );
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="page" value={page} />
      <input type="hidden" name="query" value={sp.toString()} />
      <input name="name" required placeholder="Название" className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
      <SubmitButton size="sm">OK</SubmitButton>
      {state && "error" in state && state.error ? <span className="text-xs text-rose-700">{state.error}</span> : null}
    </form>
  );
}

export function MobileNavToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button type="button" aria-label="Меню" onClick={() => setOpen((v) => !v)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

/** Строки заказа: динамическое добавление товаров */
export function OrderItemsEditor({
  products,
  directions,
  initial,
}: {
  products: { id: string; name: string; hint?: string | null }[];
  directions: { id: string; name: string; hint?: string | null }[];
  initial?: { productId?: string; productName?: string; qty?: string; price?: string; directionId?: string; due?: string }[];
}) {
  const nextKey = useRef(0);
  const withKey = (r: NonNullable<typeof initial>[number]) => ({ ...r, _k: nextKey.current++ });
  const [rows, setRows] = useState(() => (initial?.length ? initial : [{}, {}]).map(withKey));
  const [vals, setVals] = useState(() => (initial?.length ? initial : [{}, {}]).map((r) => ({ qty: r.qty ?? "", price: r.price ?? "" })));
  const total = vals.reduce((s, v) => s + (Number(v.qty.replace(",", ".")) || 0) * (Number(v.price.replace(",", ".")) || 0), 0);
  const productOpts = products.map((p) => ({ value: p.id, label: p.name, hint: p.hint }));
  const directionOpts = directions.map((d) => ({ value: d.id, label: d.name, hint: d.hint }));
  return (
    <div>
      <div className="hidden gap-2 px-1 pb-1 text-xs font-medium text-slate-500 sm:grid sm:grid-cols-[minmax(0,4fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.8fr)_minmax(0,1.7fr)_auto]">
        <div>Товар</div>
        <div>Количество</div>
        <div>Цена за ед., ₽</div>
        <div title="Если пусто — общая плановая дата заказа">Срок, если другой</div>
        <div>Направление</div>
        <div className="w-12" />
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r._k} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 sm:border-0 sm:p-0 sm:grid-cols-[minmax(0,4fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.8fr)_minmax(0,1.7fr)_auto]">
            {/* free: можно вписать новый товар — сервер проверит похожие и спросит */}
            <Combobox name="item_product" free options={productOpts} defaultValue={r.productName ?? ""} placeholder="Начните вводить название или артикул" className="col-span-2 sm:col-span-1" inputClassName="py-2" />
            <input
              name="item_qty"
              inputMode="decimal"
              defaultValue={r.qty}
              placeholder="Кол-во"
              onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              name="item_price"
              inputMode="decimal"
              defaultValue={r.price}
              placeholder="Цена"
              onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {/* свой срок позиции; пусто — общая плановая дата заказа */}
            <input name="item_due" type="date" defaultValue={r.due} title="Срок поставки этой позиции, если отличается от общего" className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700" />
            <Combobox name="item_direction" options={directionOpts} defaultValue={r.directionId ?? ""} placeholder="как у заказа" inputClassName="py-2" />
            <button
              type="button"
              className="w-12 text-sm text-slate-400 hover:text-rose-600"
              onClick={() => {
                setRows((x) => x.filter((_, j) => j !== i));
                setVals((x) => x.filter((_, j) => j !== i));
              }}
            >
              Убрать
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          className={btnClass("secondary", "sm")}
          onClick={() => {
            setRows((x) => [...x, withKey({})]);
            setVals((x) => [...x, { qty: "", price: "" }]);
          }}
        >
          + Добавить товар
        </button>
        <div className="text-sm text-slate-600">
          Итого: <b className="tabular-nums">{total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽</b>
        </div>
      </div>
    </div>
  );
}

export function useQueryNav() {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  return (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v === null || v === "" ? q.delete(k) : q.set(k, v));
    router.push(`${pathname}?${q.toString()}`);
  };
}

/** Способ оплаты заказа; для комплексной — сколько платим наличными (остальное безнал) */
export function OrderPayFields({ method, cash, className }: { method?: string | null; cash?: string | null; className?: string }) {
  const [m, setM] = useState(method ?? "");
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Способ оплаты</span>
        <select name="paymentMethod" value={m} onChange={(e) => setM(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-800 focus:border-brand-500 focus:outline-none">
          <option value="">— не указан</option>
          <option value="BANK">Безнал</option>
          <option value="CASH">Наличные</option>
          <option value="MIXED">Комплексная (нал + безнал)</option>
        </select>
      </label>
      {m === "MIXED" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Из них наличными, ₽</span>
          <input name="cashPlanned" inputMode="decimal" defaultValue={cash ?? ""} placeholder="остальное — безнал" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none" />
          <span className="mt-1 block text-xs text-slate-500">Можно не заполнять, если доли ещё неизвестны</span>
        </label>
      )}
    </div>
  );
}

/**
 * Кнопки хода задачи («Взять в работу», «Отправить на согласование», «Согласовать» …).
 * Шаги с комментарием открывают поле (причина возврата — обязательна), «Отменить» — спрашивает подтверждение.
 * compact — в списках: только главная кнопка, без комментария.
 */
export function TaskStepButtons({ action, taskId, steps, compact }: { action: FormAction; taskId: string; steps: TaskStep[]; compact?: boolean }) {
  const [open, setOpen] = useState<TaskStep | null>(null);
  const shown = compact ? steps.filter((s) => TASK_STEPS[s].tone === "primary").slice(0, 1) : steps;
  if (!shown.length) return null;
  const cur = open ? TASK_STEPS[open] : null;
  return (
    <ActionForm action={action} className={compact ? "" : "space-y-2"}>
      <input type="hidden" name="id" value={taskId} />
      {open && cur ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <input type="hidden" name="step" value={open} />
          {cur.comment ? (
            <textarea name="comment" rows={2} required={cur.comment === "required"} placeholder={cur.placeholder} autoFocus className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          ) : (
            <div className="text-sm text-slate-700">{cur.label}?</div>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" variant={cur.tone === "danger" ? "danger" : "primary"}>{cur.comment ? cur.label : "Да"}</SubmitButton>
            <button type="button" className={btnClass("ghost", "sm")} onClick={() => setOpen(null)}>Назад</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shown.map((s) => {
            const st = TASK_STEPS[s];
            const ask = !compact && (st.comment || s === "cancel");
            return ask ? (
              <button key={s} type="button" className={btnClass(st.tone, "sm")} onClick={() => setOpen(s)}>{st.label}</button>
            ) : (
              <SubmitButton key={s} size="sm" variant={st.tone} name="step" value={s}>{st.label}</SubmitButton>
            );
          })}
        </div>
      )}
    </ActionForm>
  );
}

/**
 * Строка таблицы, которая по нажатию раскрывает под собой подробности на всю ширину (например, долг поставщика по заказам).
 * cells — ячейки строки; первая получает стрелку ▸/▾. detail — содержимое раскрытой части.
 */
export function ExpandableRow({ cells, detail, cols, defaultOpen = false }: { cells: ReactNode[]; detail: ReactNode; cols: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <tr className={cn("cursor-pointer hover:bg-slate-50", open && "bg-slate-50")} onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) setOpen((v) => !v); }} aria-expanded={open}>
        {cells.map((c, i) => (
          <td key={i} className={cn("border-b border-slate-100 px-3 py-2 align-top text-slate-700", i > 0 && "whitespace-nowrap text-right tabular-nums")}>
            {i === 0 && <span className={cn("mr-1.5 inline-block text-slate-400 transition", open && "rotate-90")}>▸</span>}
            {c}
          </td>
        ))}
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} className="border-b border-slate-200 bg-slate-50 px-3 pb-3 pt-1">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
