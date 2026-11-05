import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { logoutAction } from "@/app/actions/common";
import { MobileNavToggle } from "@/components/client";
import { NavLinks, type NavItem } from "./nav";
import { ensureTaskReminders } from "@/lib/services/reminders";
import { ensureContractReminders } from "@/lib/services/contracts";
import { orderScope, ORDER_STATS, OVERDUE_SQL } from "@/lib/services/orders";
import { ROLE_LABEL, today } from "@/lib/format";
import { btnClass } from "@/components/ui";

async function counters(u: SessionUser) {
  const d = today();
  const res = await db.execute(sql`
    WITH ${ORDER_STATS}
    SELECT
      (SELECT COUNT(*) FROM purchase_orders o LEFT JOIN order_stats os ON os.order_id = o.id WHERE o.deleted_at IS NULL AND ${orderScope(u)} AND ${OVERDUE_SQL(d)})::int AS overdue,
      (SELECT COUNT(*) FROM tasks WHERE assignee_id = ${u.id} AND deleted_at IS NULL AND status IN ('NEW','IN_PROGRESS','WAITING'))::int AS tasks,
      (SELECT COUNT(*) FROM notifications WHERE user_id = ${u.id} AND read_at IS NULL)::int AS notif`);
  return res.rows[0] as { overdue: number; tasks: number; notif: number };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  await Promise.all([ensureTaskReminders(u.id), ensureContractReminders()]);
  const c = await counters(u);

  const items: NavItem[] = [
    { href: "/", label: "Главная", icon: "home" },
    { href: "/orders", label: "Заказы", icon: "orders" },
    { href: "/deliveries", label: "Поставки", icon: "truck", badge: c.overdue, badgeTone: "red" },
    { href: "/suppliers", label: "Поставщики", icon: "building" },
    { href: "/products", label: "Товары", icon: "box" },
    { href: "/payments", label: "Оплаты", icon: "wallet" },
    { href: "/tasks", label: "Задачи", icon: "check", badge: c.tasks },
  ];
  if (can(u, PERMS.statsViewAll)) items.push({ href: "/analytics", label: "Аналитика", icon: "chart" });
  if (can(u, PERMS.usersManage)) items.push({ href: "/users", label: "Пользователи", icon: "users" });
  if (can(u, PERMS.settingsEdit) || can(u, PERMS.importRun) || can(u, PERMS.auditView)) items.push({ href: "/settings", label: "Настройки", icon: "settings" });

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">З</div>
        <div className="text-sm font-semibold">CRM закупок</div>
      </div>
      <NavLinks items={items} />
      <div className="mt-auto border-t border-slate-100 p-3">
        <Link href="/profile" className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">
          <div className="truncate text-sm font-medium text-slate-800">{u.name}</div>
          <div className="text-xs text-slate-500">{ROLE_LABEL[u.role]}</div>
        </Link>
        <form action={logoutAction}>
          <button className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800">Выйти</button>
        </form>
      </div>
    </div>
  );

  const canEdit = can(u, PERMS.ordersEdit);
  return (
    <div className="lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur sm:px-6">
        <MobileNavToggle>{sidebar}</MobileNavToggle>
        <form action="/search" className="min-w-0 flex-1">
          <input name="q" placeholder="Поиск: № заказа, счёт, поставщик, товар" className="w-full max-w-md rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none" />
        </form>
        <Link href="/calendar" className={btnClass("secondary", "sm")} title="Календарь поставок">
          <CalendarDays size={16} strokeWidth={1.8} className="text-brand-600" />
          <span className="hidden sm:inline">Календарь поставок</span>
        </Link>
        {canEdit && (
          <div className="hidden gap-1.5 md:flex">
            <Link href="/orders/new" className={btnClass("primary", "sm")}>
              + Заказ
            </Link>
            <Link href="/deliveries/new" className={btnClass("secondary", "sm")}>
              + Поставка
            </Link>
            <Link href="/payments/new" className={btnClass("secondary", "sm")}>
              + Оплата
            </Link>
          </div>
        )}
        <Link href="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Уведомления">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {c.notif > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{c.notif}</span>}
        </Link>
      </header>
      <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">{children}</main>
    </div>
  );
}
