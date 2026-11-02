import ExcelJS from "exceljs";

export interface Col {
  header: string;
  key: string;
  width?: number;
  fmt?: "money" | "qty" | "date" | "price";
}

/** Книга Excel из набора листов; суммы и количества — числами, чтобы с ними можно было считать */
export async function buildXlsx(sheets: { name: string; columns: Col[]; rows: Record<string, unknown>[] }[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM закупок";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
    for (const r of s.rows) {
      const row: Record<string, unknown> = {};
      for (const c of s.columns) {
        let v = r[c.key];
        if (v !== null && v !== undefined && (c.fmt === "money" || c.fmt === "qty" || c.fmt === "price")) v = Number(v);
        if (c.fmt === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) v = new Date(v.slice(0, 10) + "T00:00:00Z");
        row[c.key] = v ?? null;
      }
      ws.addRow(row);
    }
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.fmt === "money") col.numFmt = "#,##0.00";
      if (c.fmt === "price") col.numFmt = "#,##0.00##";
      if (c.fmt === "qty") col.numFmt = "#,##0.###";
      if (c.fmt === "date") col.numFmt = "dd.mm.yyyy";
    });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, name: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
