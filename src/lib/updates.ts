import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { CHANGELOG } from "./changelog";

const KEY = "announcedVersion";

/**
 * Рассылает уведомления о версиях из CHANGELOG, которые ещё не объявлялись.
 * Вызывается при старте контейнера (scripts/migrate.ts), поэтому без "server-only".
 * Самый первый запуск объявляет только последнюю версию, чтобы не засыпать историей.
 */
export async function announceUpdates() {
  if (!CHANGELOG.length) return 0;
  return db.transaction(async (tx) => {
    // защита от двойной рассылки, если два экземпляра стартуют одновременно
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${KEY}))`);
    const [row] = await tx.select().from(schema.settings).where(eq(schema.settings.key, KEY));
    const last = row ? String(row.value) : null;
    const idx = last ? CHANGELOG.findIndex((r) => r.version === last) : 1;
    const fresh = CHANGELOG.slice(0, idx === -1 ? CHANGELOG.length : idx).reverse();
    if (!fresh.length) return 0;

    const users = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isActive, true));
    for (const r of fresh) {
      if (!users.length) break;
      await tx.insert(schema.notifications).values(
        users.map((u) => ({
          userId: u.id,
          type: "app_update",
          title: `Обновление программы: ${r.title}`,
          body: r.items.map((i) => `• ${i}`).join("\n"),
          link: `/whats-new#v-${r.version}`,
        })),
      );
    }
    await tx
      .insert(schema.settings)
      .values({ key: KEY, value: CHANGELOG[0].version })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: CHANGELOG[0].version } });
    return fresh.length;
  });
}
