import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { logActivity } from "@/lib/audit";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";
import { today } from "@/lib/format";

/** Полная выгрузка всех таблиц (кроме паролей и сессий) — ручная резервная копия */
const TABLES = ["suppliers", "supplier_buyers", "products", "product_suppliers", "legal_entities", "directions", "purchase_orders", "purchase_order_items", "deliveries", "delivery_items", "payments", "tasks", "task_comments", "comments", "documents", "supplier_contracts", "supply_plan_entries", "activity_logs", "import_batches", "settings"];

export async function GET() {
  const u = await getCurrentUser();
  if (!u || !can(u, PERMS.settingsEdit)) return new Response("Нет доступа", { status: 403 });
  const sheets = [];
  const users = await db.execute(sql`SELECT u.id, u.login, u.name, u.email, u.phone, u.position, r.code AS role, u.extra_permissions, u.revoked_permissions, u.is_active, u.created_at FROM users u JOIN roles r ON r.id = u.role_id`);
  sheets.push({ name: "users", columns: Object.keys(users.rows[0] ?? {}).map((k) => ({ header: k, key: k })), rows: users.rows as Record<string, unknown>[] });
  for (const t of TABLES) {
    const res = await db.execute(sql.raw(`SELECT * FROM ${t}`));
    const rows = (res.rows as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v])));
    const keys = res.fields.map((f) => f.name);
    sheets.push({ name: t, columns: keys.map((k) => ({ header: k, key: k })), rows });
  }
  await logActivity(db, { userId: u.id, action: "export", entityType: "settings", entityId: "backup", summary: "Скачана полная резервная копия данных" });
  return xlsxResponse(await buildXlsx(sheets), `crm-backup-${today()}.xlsx`);
}
