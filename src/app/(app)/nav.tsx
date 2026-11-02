"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Home, ClipboardList, Truck, Building2, Package, Wallet, CheckSquare, BarChart3, Users, Settings } from "lucide-react";

const icons = { home: Home, orders: ClipboardList, truck: Truck, building: Building2, box: Package, wallet: Wallet, check: CheckSquare, chart: BarChart3, users: Users, settings: Settings };
export type NavItem = { href: string; label: string; icon: keyof typeof icons; badge?: number; badgeTone?: "red" };

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5 px-2">
      {items.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const Icon = icons[it.icon];
        return (
          <Link
            key={it.href}
            href={it.href}
            className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span className="flex-1">{it.label}</span>
            {!!it.badge && (
              <span className={clsx("rounded-full px-1.5 text-xs font-semibold", it.badgeTone === "red" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{it.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
