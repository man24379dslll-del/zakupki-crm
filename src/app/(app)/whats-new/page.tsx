import { requireUser } from "@/lib/auth";
import { CHANGELOG } from "@/lib/changelog";
import { fmtDate } from "@/lib/format";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Что нового" };

export default async function WhatsNew() {
  await requireUser();
  return (
    <>
      <PageHeader title="Что нового" subtitle="Обновления программы, новые сверху" back={{ href: "/notifications", label: "Уведомления" }} />
      {CHANGELOG.length === 0 ? (
        <Card><Empty>Обновлений пока не было</Empty></Card>
      ) : (
        <div className="space-y-4">
          {CHANGELOG.map((r) => (
            <Card key={r.version} title={<span id={`v-${r.version}`} className="scroll-mt-20">{r.title} · <span className="font-normal text-slate-500">{fmtDate(r.date)}</span></span>}>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {r.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
