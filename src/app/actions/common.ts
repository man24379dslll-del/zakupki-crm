"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, createSession, destroySession, getCurrentUser, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import type { ActionResult } from "@/components/client";

// простая защита от перебора паролей: 5 неудачных попыток за 10 минут на логин
const fails = new Map<string, { n: number; until: number }>();

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const login = String(fd.get("login") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const f = fails.get(login);
  if (f && f.n >= 5 && f.until > Date.now()) return { error: "Слишком много попыток. Повторите через 10 минут." };
  const [u] = await db.select().from(schema.users).where(eq(schema.users.login, login));
  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + 10 * 60e3 };
    cur.n++;
    fails.set(login, cur);
    return { error: "Неверный логин или пароль" };
  }
  if (!u.isActive) return { error: "Учётная запись заблокирована. Обратитесь к руководителю." };
  fails.delete(login);
  await createSession(u.id);
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await logActivity(db, { userId: u.id, action: "login", entityType: "user", entityId: u.id, summary: "Вход в систему", ip: await clientIp() });
  redirect(u.mustChangePassword ? "/profile?first=1" : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const u = await requireUser();
  const cur = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (next.length < 8) return { error: "Новый пароль — не короче 8 символов" };
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  if (!(await verifyPassword(cur, row.passwordHash))) return { error: "Текущий пароль неверен" };
  await db.update(schema.users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(schema.users.id, u.id));
  await logActivity(db, { userId: u.id, action: "update", entityType: "user", entityId: u.id, summary: "Смена пароля" });
  return { ok: "Пароль изменён" };
}

export async function saveViewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const u = await requireUser();
  const page = String(fd.get("page"));
  const name = String(fd.get("name") ?? "").trim();
  const query = String(fd.get("query") ?? "");
  if (!name) return { error: "Введите название" };
  await db.insert(schema.savedViews).values({ userId: u.id, page, name, query });
  revalidatePath(page);
  return { ok: "Сохранено" };
}

export async function deleteViewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const u = await requireUser();
  await db.delete(schema.savedViews).where(and(eq(schema.savedViews.id, String(fd.get("id"))), eq(schema.savedViews.userId, u.id)));
  revalidatePath("/");
}

export async function markNotificationsRead() {
  const u = await getCurrentUser();
  if (!u) return;
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, u.id), isNull(schema.notifications.readAt)));
  revalidatePath("/notifications");
}

void sql;
