import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { allProductsAvg } from "@/lib/services/prices";
import { fmtDate, fmtPrice, fmtQty } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { ExportLink, FilterBar, FSelect, pageParams, Pagination, qp, SearchInput, type SP } from "@/components/list";

export const metadata = { title: "Товары" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const { page, limit, offset } = pageParams(sp, 100);
  const w = [sql`p.merged_into_id IS NULL`];
  const q = qp(sp, "q");
  if (q) w.push(sql`(p.name ILIKE ${"%" + q + "%"} OR p.sku ILIKE ${"%" + q + "%"})`);
  const cat = qp(sp, "category");
  if (cat) w.push(sql`p.category = ${cat}`);
  const act = qp(sp, "active");
  if (act !== "all") w.push(sql`p.is_active`);
  const [res, cats, avg] = await Promise.all([
    db.execute(sql`
      SELECT p.id, p.name, p.sku, p.category, p.unit, p.is_active,
        (SELECT string_agg(s.name, ', ') FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE ps.product_id = p.id) AS suppliers,
        (SELECT COUNT(*) FROM product_suppliers ps WHERE ps.product_id = p.id)::int AS supplier_count,
        (SELECT MAX(d.date) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL WHERE di.product_id = p.id) AS last_delivery,
        (SELECT di.price FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL WHERE di.product_id = p.id AND di.price IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS last_price,
        COUNT(*) OVER()::int AS total
      FROM products p WHERE ${sql.join(w, sql` AND `)}
      ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`),
    db.execute(sql`SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY 1`),
    allProductsAvg(6),
  ]);
  const rows = res.rows as { id: string; name: string; sku: string | null; category: string | null; unit: string; is_active: boolean; suppliers: string | null; supplier_count: number; last_delivery: string | null; last_price: string | null; total: number }[];
  return (
    <>
      <PageHeader
        title="Товары"
        subtitle={`Средневзвешенная цена — за период ${fmtDate(avg.window.from)} — ${fmtDate(avg.window.to)} по фактическим поставкам`}
        actions={
          <>
            <ExportLink entity="products" sp={sp} />
            {can(u, PERMS.productsMerge) && <LinkButton href="/products/duplicates">Найти дубли</LinkButton>}
            {can(u, PERMS.productsEdit) && <LinkButton href="/products/new" variant="primary">+ Товар</LinkButton>}
          </>
        }
      />
      <FilterBar base="/products" sp={sp}>
        <SearchInput sp={sp} placeholder="Название или артикул" />
        <FSelect searchable name="category" sp={sp} placeholder="Все категории" options={(cats.rows as { category: string }[]).map((c) => ({ value: c.category, label: c.category }))} />
        <FSelect name="active" sp={sp} placeholder="Только активные" options={[{ value: "all", label: "Все, включая неактивные" }]} />
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <Empty>Товаров не найдено</Empty> : (
          <Table>
            <thead><tr><Th>Товар</Th><Th>Поставщики</Th><Th right>Последняя цена</Th><Th right>Средняя за 6 мес.</Th><Th right>Куплено за 6 мес.</Th><Th>Последняя поставка</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const a = avg.map.get(r.id);
                return (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/products/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link>
                      <div className="flex gap-1 text-xs text-slate-500">{r.sku && <span>арт. {r.sku}</span>}{r.category && <Badge>{r.category}</Badge>}{!r.is_active && <Badge tone="gray">неактивен</Badge>}</div>
                    </Td>
                    <Td className="max-w-64 truncate text-xs">{r.suppliers ?? "—"}{r.supplier_count > 1 && <Badge tone="blue">{r.supplier_count}</Badge>}</Td>
                    <Td right>{fmtPrice(r.last_price)}</Td>
                    <Td right className="font-medium">{a?.avg != null ? fmtPrice(a.avg) : <span className="text-xs font-normal text-slate-400">Нет данных</span>}</Td>
                    <Td right>{a ? `${fmtQty(a.qty)} ${r.unit}` : "—"}</Td>
                    <Td>{fmtDate(r.last_delivery)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/products" sp={sp} total={rows[0]?.total ?? 0} page={page} size={limit} />
      </Card>
    </>
  );
}
