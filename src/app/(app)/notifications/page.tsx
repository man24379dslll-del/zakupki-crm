import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { markNotificationsRead } from "@/app/actions/common";
import { Card, Empty, PageHeader, cn, btnClass } from "@/components/ui";

export const metadata = { title: "Уведомления" };

export default async function Notifications() {
  const u = await requireUser();
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, u.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader title="Уведомления" actions={rows.some((r) => !r.readAt) && <form action={markNotificationsRead}><button className={btnClass("secondary", "sm")}>Отметить все прочитанными</button></form>} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty>Уведомлений нет</Empty> : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id} className={cn("px-4 py-3", !n.readAt && "bg-brand-50/40")}>
                <div className="text-xs text-slate-500">{fmtDateTime(n.createdAt)}</div>
                {n.link ? <Link href={n.link} className={cn("text-sm hover:text-brand-700", !n.readAt && "font-semibold")}>{n.title}</Link> : <span className="text-sm">{n.title}</span>}
                {n.body && <div className="text-sm text-slate-600">{n.body}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
