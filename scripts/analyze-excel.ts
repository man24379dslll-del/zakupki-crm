import { readFileSync } from "node:fs";
import { parseWorkbook, itemFingerprint } from "../src/lib/import/parser";

const file = process.argv[2] ?? "../src/orders.xlsx";
(async () => {
  const res = await parseWorkbook(readFileSync(file), file);
  const allFp = new Map<string, string[]>();
  for (const s of res.sheets) {
    const items = s.orders.flatMap((o) => o.items);
    const deliveries = items.flatMap((i) => i.deliveries);
    const pays = s.orders.flatMap((o) => o.payments);
    const suppliers = new Set(s.orders.map((o) => o.supplier).concat(s.plan.map((p) => p.supplier)));
    const products = new Set(items.map((i) => i.product.toLowerCase()).concat(s.plan.map((p) => p.product.toLowerCase())));
    const sumOrdered = items.reduce((a, i) => a + (i.qty ?? 0) * (i.price ?? 0), 0);
    const delivered = deliveries.reduce((a, d) => a + d.qty, 0);
    const paid = pays.reduce((a, p) => a + p.amount, 0) + s.supplierPayments.reduce((a, p) => a + p.amount, 0);
    const byCode = new Map<string, number>();
    for (const i of s.issues) byCode.set(`${i.level}:${i.code}`, (byCode.get(`${i.level}:${i.code}`) ?? 0) + 1);
    console.log(`\n### ${s.name} [${s.kind}] header=${s.headerRow}`);
    console.log(` orders=${s.orders.length} items=${items.length} deliveries=${deliveries.length} payments=${pays.length} supplierPayments=${s.supplierPayments.length} plan=${s.plan.length}`);
    console.log(` suppliers=${suppliers.size} [${[...suppliers].join("; ")}]`);
    console.log(` products=${products.size}`);
    console.log(` sum ordered=${sumOrdered.toFixed(2)} deliveredQty=${delivered} paid=${paid}`);
    console.log(` excelTotals=${JSON.stringify(s.excelTotals)}`);
    console.log(` legalEntities=${[...new Set(s.orders.map((o) => o.legalEntity))].join("; ")}`);
    console.log(` directions=${[...new Set(s.orders.map((o) => o.direction))].join("; ")}`);
    console.log(` invoices=${s.orders.map((o) => o.invoice).join(",")}`);
    console.log(` deliveryDates=${s.deliveryDates.filter((d) => d.date).length}/${s.deliveryDates.length}`);
    console.log(` skipped=${s.skippedRows.length}`);
    console.log(` issues: ${[...byCode].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    for (const i of s.issues.filter((x) => x.level !== "info").slice(0, 12)) console.log(`   - [${i.level}] r${i.row ?? ""} ${i.message}`);
    if ((s as any).duplicateOf) continue;
    for (const o of s.orders) for (const it of o.items) {
      const f = itemFingerprint(o, it);
      if (!allFp.has(f)) allFp.set(f, []);
      allFp.get(f)!.push(`${s.name}!${it.row}`);
    }
  }
  const dups = [...allFp].filter(([, v]) => v.length > 1);
  console.log(`\n### duplicates among non-copy sheets: ${dups.length}`);
  for (const [f, v] of dups.slice(0, 20)) console.log(" ", f, v.join(", "));
  const copy = res.sheets.find((s) => (s as any).dupInfo);
  if (copy) console.log("\ncopy info", JSON.stringify((copy as any).dupInfo).slice(0, 800));
  // groups with multiple orders same invoice in a sheet
  for (const s of res.sheets) {
    const m = new Map<string, number>();
    for (const o of s.orders) if (o.invoice) m.set(`${o.supplier}|${o.invoice}`, (m.get(`${o.supplier}|${o.invoice}`) ?? 0) + 1);
    const rep = [...m].filter(([, v]) => v > 1);
    if (rep.length) console.log(`\nrepeated invoice in ${s.name}:`, rep.map(([k, v]) => `${k}×${v}`).join("; "));
  }
})();
