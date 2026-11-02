/** Запускается при каждом старте контейнера: применяет миграции и создаёт роли/руководителя, если их нет */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";
import { seed } from "./seed";

(async () => {
  const t = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed();
  console.log(`База готова (${Date.now() - t} мс)`);
  await pool.end();
})().catch((e) => {
  console.error("Ошибка миграции:", e);
  process.exit(1);
});
