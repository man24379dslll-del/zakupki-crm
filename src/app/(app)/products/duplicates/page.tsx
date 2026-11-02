import Link from "next/link";
import { isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { isSimilar } from "@/lib/normalize";
import { ActionForm, SubmitButton } from "@/components/client";
import { Alert, Card, Empty, PageHeader } from "@/components/ui";
import { mergeProductsAction } from "../actions";

export const metadata = { title: "Дубли товаров" };

/** Группы похожих названий. Руководитель выбирает основной товар и отмечает дубли. */
export default async function Duplicates() {
  await requirePerm(PERMS.productsMerge);
  const ps = await db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(isNull(schema.products.mergedIntoId)).orderBy(schema.products.name);
  const uses = await db.execute(sql`SELECT product_id, COUNT(*)::int n FROM purchase_order_items GROUP BY 1`);
  const n = new Map((uses.rows as { product_id: string; n: number }[]).map((r) => [r.product_id, r.n]));
  const seen = new Set<string>();
  const groups: { id: string; name: string }[][] = [];
  for (const a of ps) {
    if (seen.has(a.id)) continue;
    const g = [a, ...ps.filter((b) => b.id !== a.id && !seen.has(b.id) && isSimilar(a.name, b.name))];
    if (g.length > 1) {
      g.forEach((x) => seen.add(x.id));
      groups.push(g.sort((x, y) => (n.get(y.id) ?? 0) - (n.get(x.id) ?? 0)));
    }
  }
  return (
    <>
      <PageHeader title="Возможные дубли товаров" back={{ href: "/products", label: "Товары" }} />
      <div className="mb-4">
        <Alert tone="blue">Объединение переносит все позиции заказов, поставки и историю цен на основной товар. Дубль скрывается из справочника, ссылки на него ведут на основной. Действие записывается в журнал.</Alert>
      </div>
      {groups.length === 0 ? <Card><Empty>Похожих названий не найдено</Empty></Card> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g[0].id}>
              <ActionForm action={mergeProductsAction}>
                <div className="mb-2 text-xs text-slate-500">Основной — ●, дубли для объединения — ☑</div>
                {g.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2 py-1 text-sm">
                    <input type="radio" name="target" value={p.id} defaultChecked={i === 0} />
                    <input type="checkbox" name="source" value={p.id} />
                    <Link href={`/products/${p.id}`} className="flex-1 hover:text-brand-700">{p.name}</Link>
                    <span className="text-xs text-slate-400">{n.get(p.id) ?? 0} поз.</span>
                  </div>
                ))}
                <div className="mt-2"><SubmitButton size="sm" variant="secondary">Объединить отмеченные</SubmitButton></div>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
