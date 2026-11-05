import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { can, effectivePerms, type Perm, type SessionUser } from "./permissions";

const COOKIE = "crm_session";
const SESSION_DAYS = 14;

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await db.insert(schema.sessions).values({
    id: sha(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5),
    ip: h.get("x-forwarded-for")?.split(",")[0] ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  // чистим просроченные
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha(t)));
  c.delete(COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const rows = await db
    .select({ u: schema.users, r: schema.roles })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.sessions.id, sha(t)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.u.isActive) return null;
  return {
    id: row.u.id,
    name: row.u.name,
    login: row.u.login,
    role: row.r.code,
    perms: effectivePerms(row.r.permissions, row.u.extraPermissions, row.u.revokedPermissions),
  };
});

/** Для страниц: нет сессии → на вход */
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export class AccessError extends Error {
  constructor(msg = "Недостаточно прав для этого действия") {
    super(msg);
  }
}

/** Для серверных действий и страниц: проверка права на сервере */
export async function requirePerm(p: Perm): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, p)) throw new AccessError();
  return u;
}

/** Для страниц: нет права — понятная страница «Нет доступа» вместо ошибки */
export async function requirePagePerm(p: Perm): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, p)) redirect(`/no-access?perm=${encodeURIComponent(p)}`);
  return u;
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0] ?? null;
}
