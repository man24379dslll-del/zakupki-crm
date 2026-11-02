/**
 * Начальные данные: роли и учётная запись руководителя.
 * Запуск: npm run db:seed  (ADMIN_LOGIN / ADMIN_PASSWORD можно задать в окружении)
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "../src/db";
import { ROLE_DEFAULTS } from "../src/lib/permissions";

export async function seed() {
  for (const [code, r] of Object.entries(ROLE_DEFAULTS)) {
    await db
      .insert(schema.roles)
      .values({ code: code as "ADMIN", name: r.name, permissions: r.perms })
      .onConflictDoUpdate({ target: schema.roles.code, set: { name: r.name, permissions: r.perms } });
  }
  const login = (process.env.ADMIN_LOGIN ?? "admin").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "admin12345";
  const [admin] = await db.select().from(schema.roles).where(eq(schema.roles.code, "ADMIN"));
  const [ex] = await db.select().from(schema.users).where(eq(schema.users.login, login));
  if (!ex) {
    await db.insert(schema.users).values({ login, name: "Руководитель", passwordHash: await bcrypt.hash(password, 10), roleId: admin.id, mustChangePassword: !process.env.ADMIN_PASSWORD });
    console.log(`Создан пользователь ${login} / ${password}`);
  } else console.log(`Пользователь ${login} уже есть`);
  await db.insert(schema.settings).values([
    { key: "priceWindowMode", value: "rolling" },
    { key: "defaultLeadDays", value: 30 },
  ]).onConflictDoNothing();
}

if (process.argv[1]?.endsWith("seed.ts"))
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
