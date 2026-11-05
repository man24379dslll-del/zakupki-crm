"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIp, hashPassword, requirePerm } from "@/lib/auth";
import { effectivePerms, GRANTABLE, permDelta, PERMS, PERM_LABELS, type Perm } from "@/lib/permissions";
import { logActivity } from "@/lib/audit";
import { fstr, safe, UserError } from "@/lib/forms";
import { ROLE_LABEL } from "@/lib/format";
import type { ActionResult } from "@/components/client";

const genPassword = () => randomBytes(6).toString("base64url");

export async function createUserAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.usersManage);
    const login = fstr(fd.get("login"))?.toLowerCase();
    const name = fstr(fd.get("name"));
    if (!login || !/^[a-z0-9._-]{3,32}$/.test(login)) throw new UserError("Логин: 3–32 символа, латиница, цифры, точка, дефис");
    if (!name) throw new UserError("Укажите ФИО");
    const roleCode = (fstr(fd.get("role")) ?? "BUYER") as "BUYER";
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.code, roleCode));
    const [ex] = await db.select().from(schema.users).where(eq(schema.users.login, login));
    if (ex) throw new UserError("Такой логин уже занят");
    const password = fstr(fd.get("password")) ?? genPassword();
    if (password.length < 8) throw new UserError("Пароль — не короче 8 символов");
    const extra = fd.getAll("perm").map(String).filter((p) => GRANTABLE.includes(p as Perm));
    const [nu] = await db
      .insert(schema.users)
      .values({ login, name, email: fstr(fd.get("email")), phone: fstr(fd.get("phone")), position: fstr(fd.get("position")), passwordHash: await hashPassword(password), roleId: role.id, extraPermissions: extra, mustChangePassword: true })
      .returning();
    await logActivity(db, { userId: u.id, action: "create", entityType: "user", entityId: nu.id, summary: `Создан пользователь ${name} (${ROLE_LABEL[roleCode]})`, ip: await clientIp() });
    revalidatePath("/users");
    return { ok: `Пользователь создан. Логин: ${login}, временный пароль: ${password} — передайте сотруднику, при первом входе он сменит пароль.` };
  });
}

export async function updateUserAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.usersManage);
    const id = String(fd.get("id"));
    const [t] = await db.select({ u: schema.users, r: schema.roles }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(eq(schema.users.id, id));
    if (!t) throw new UserError("Пользователь не найден");
    const roleCode = (fstr(fd.get("role")) ?? t.r.code) as "ADMIN" | "BUYER" | "VIEWER";
    if (id === u.id && roleCode !== "ADMIN") throw new UserError("Нельзя снять с себя роль руководителя");
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.code, roleCode));
    // смена роли — права по умолчанию новой роли (галочки относились к старой); иначе — как отмечено
    const roleChanged = role.id !== t.u.roleId;
    const { extra, revoked } = roleChanged ? { extra: [], revoked: [] } : permDelta(role.permissions, fd.getAll("perm").map(String));
    const after = effectivePerms(role.permissions, extra, revoked);
    if (id === u.id && !after.has(PERMS.usersManage)) throw new UserError("Нельзя снять с себя право «Управлять пользователями» — иначе вы потеряете доступ к этой странице");
    if (!after.has(PERMS.usersManage)) {
      // в системе должен остаться хотя бы один активный сотрудник, который управляет пользователями
      const others = await db.select({ u: schema.users, r: schema.roles }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(and(eq(schema.users.isActive, true), ne(schema.users.id, id)));
      if (!others.some((x) => effectivePerms(x.r.permissions, x.u.extraPermissions, x.u.revokedPermissions).has(PERMS.usersManage))) throw new UserError("Это последний сотрудник, который может управлять пользователями — право снять нельзя");
    }
    const next = { name: fstr(fd.get("name")) ?? t.u.name, email: fstr(fd.get("email")), phone: fstr(fd.get("phone")), position: fstr(fd.get("position")), roleId: role.id, extraPermissions: extra, revokedPermissions: revoked };
    const changes: Record<string, [unknown, unknown]> = {};
    if (roleChanged) changes["Роль"] = [ROLE_LABEL[t.r.code], ROLE_LABEL[roleCode]];
    const before = effectivePerms(t.r.permissions, t.u.extraPermissions, t.u.revokedPermissions);
    const added = [...after].filter((p) => !before.has(p)).map((p) => PERM_LABELS[p as Perm]);
    const removed = [...before].filter((p) => !after.has(p)).map((p) => PERM_LABELS[p as Perm]);
    if (added.length) changes["Права выданы"] = [null, added.join("; ")];
    if (removed.length) changes["Права сняты"] = [removed.join("; "), null];
    for (const k of ["name", "email", "phone", "position"] as const) if ((t.u[k] ?? null) !== (next[k] ?? null)) changes[k] = [t.u[k], next[k]];
    await db.update(schema.users).set(next).where(eq(schema.users.id, id));
    await logActivity(db, { userId: u.id, action: "update", entityType: "user", entityId: id, summary: `Изменён пользователь ${next.name}`, changes });
    revalidatePath("/users");
    return { ok: "Сохранено" };
  });
}

export async function toggleBlockAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.usersManage);
    const id = String(fd.get("id"));
    if (id === u.id) throw new UserError("Нельзя заблокировать себя");
    const [t] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    await db.update(schema.users).set({ isActive: !t.isActive }).where(eq(schema.users.id, id));
    if (t.isActive) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id)); // завершить все сеансы
    await logActivity(db, { userId: u.id, action: "update", entityType: "user", entityId: id, summary: `${t.isActive ? "Заблокирован" : "Разблокирован"} пользователь ${t.name}` });
    revalidatePath("/users");
  });
}

export async function resetPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const u = await requirePerm(PERMS.usersManage);
    const id = String(fd.get("id"));
    const [t] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    const password = genPassword();
    await db.update(schema.users).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(eq(schema.users.id, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await logActivity(db, { userId: u.id, action: "update", entityType: "user", entityId: id, summary: `Сброшен пароль пользователя ${t.name}` });
    return { ok: `Новый временный пароль для ${t.login}: ${password}` };
  });
}
