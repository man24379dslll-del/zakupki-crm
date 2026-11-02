/** Запускается при каждом старте контейнера: применяет миграции и создаёт роли/руководителя, если их нет */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";
import { seed } from "./seed";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Ошибка: не задана переменная DATABASE_URL. Railway → сервис → Variables → добавьте строку подключения Supabase (Session pooler, порт 5432).");
    process.exit(1);
  }
  console.log(`Подключение к БД: ${url.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@")}`);
  const t = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed();
  console.log(`База готова (${Date.now() - t} мс)`);
  await pool.end();
})().catch((e) => {
  console.error("Ошибка миграции:", e);
  process.exit(1);
});
