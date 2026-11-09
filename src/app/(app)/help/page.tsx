import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, PERMS, ROLE_DEFAULTS } from "@/lib/permissions";
import { HELP_GROUPS, helpText, visibleHelp, type HelpBlock, type HelpSection } from "@/lib/help";
import { ROLE_LABEL } from "@/lib/format";
import { Card, cn, PageHeader } from "@/components/ui";
import { qp, type SP } from "@/components/list";

export const metadata = { title: "Инструкция" };

type Role = "ADMIN" | "BUYER" | "VIEWER";

/** Инструкция по программе: только разделы, доступные сотруднику по его правам. Руководитель может посмотреть «как видит» роль. */
export default async function HelpPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const canPreview = can(u, PERMS.usersManage);
  const as = canPreview && ["ADMIN", "BUYER", "VIEWER"].includes(qp(sp, "as")) ? (qp(sp, "as") as Role) : null;
  const perms = as ? new Set<string>(ROLE_DEFAULTS[as].perms) : u.perms;
  const role = as ?? u.role;
  const all = visibleHelp(perms, role);
  const q = qp(sp, "q").trim().toLowerCase();
  const sections = q ? all.filter((s) => helpText(s).toLowerCase().includes(q)) : all;
  const groups = HELP_GROUPS.map((g) => ({ g, items: sections.filter((s) => s.group === g) })).filter((x) => x.items.length);

  return (
    <>
      <PageHeader title="Инструкция" subtitle={as ? `Так инструкцию видит роль «${ROLE_LABEL[as]}» (права по умолчанию)` : "Показаны разделы, доступные вам по вашим правам"} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form action="/help" className="flex flex-1 gap-2">
          {as && <input type="hidden" name="as" value={as} />}
          <input name="q" defaultValue={qp(sp, "q")} placeholder="Поиск по инструкции: например, «оплата» или «акт сверки»" className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Найти</button>
          {q && <Link href={as ? `/help?as=${as}` : "/help"} className="self-center text-sm text-brand-700 hover:underline">сбросить</Link>}
        </form>
        {canPreview && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-slate-500">Посмотреть как:</span>
            {([null, "BUYER", "VIEWER", "ADMIN"] as (Role | null)[]).map((r) => (
              <Link
                key={r ?? "me"}
                href={`/help?${new URLSearchParams({ ...(r ? { as: r } : {}), ...(q ? { q } : {}) })}`}
                className={cn("rounded-full border px-2.5 py-1 text-xs", (as ?? null) === r ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50")}
              >
                {r ? ROLE_LABEL[r] : "Я"}
              </Link>
            ))}
          </div>
        )}
      </div>

      {sections.length === 0 ? (
        <Card><p className="text-sm text-slate-600">Ничего не найдено. Попробуйте другое слово.</p></Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav className="lg:sticky lg:top-16 lg:self-start">
            <details open className="rounded-xl border border-slate-200 bg-white p-3 text-sm lg:[&>summary]:hidden">
              <summary className="cursor-pointer font-medium text-slate-700">Оглавление</summary>
              {groups.map(({ g, items }) => (
                <div key={g} className="mt-2 first:mt-0">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g}</div>
                  <ul className="space-y-0.5">
                    {items.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`} className="block rounded px-1.5 py-0.5 text-slate-700 hover:bg-slate-50 hover:text-brand-700">{s.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          </nav>
          <div className="space-y-4">
            {sections.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Section({ s }: { s: HelpSection }) {
  return (
    <section id={s.id} className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.group}</div>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{s.title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">
        {s.body.map((b, i) => (
          <Block key={i} b={b} />
        ))}
      </div>
    </section>
  );
}

function Block({ b }: { b: HelpBlock }) {
  if (typeof b === "string") return <p>{b}</p>;
  if ("steps" in b)
    return (
      <ol className="list-decimal space-y-1 pl-5">
        {b.steps.map((x, i) => <li key={i}>{x}</li>)}
      </ol>
    );
  if ("list" in b)
    return (
      <ul className="list-disc space-y-1 pl-5">
        {b.list.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    );
  if ("tip" in b) return <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">💡 {b.tip}</div>;
  if ("warn" in b) return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">⚠️ {b.warn}</div>;
  return (
    <a href={`/help/${b.img}.webp`} target="_blank" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/help/${b.img}.webp`} alt={b.alt} loading="lazy" className="h-auto max-w-full rounded-lg border border-slate-200 shadow-sm" />
      <span className="mt-1 block text-xs text-slate-400">{b.alt} — нажмите, чтобы открыть крупнее</span>
    </a>
  );
}
