import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { AccessError } from "@/lib/auth";
import { can, PERMS, type SessionUser } from "@/lib/permissions";
import { assertOrderAccess } from "./orders";

/** Доступ к документам/комментариям определяется доступом к объекту, к которому они прикреплены */
export async function assertEntityAccess(u: SessionUser, entityType: string, entityId: string, write = false) {
  switch (entityType) {
    case "order":
      await assertOrderAccess(u, entityId, write);
      return;
    case "delivery": {
      const [d] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, entityId));
      if (!d) throw new AccessError("Не найдено");
      await assertOrderAccess(u, d.orderId, write);
      return;
    }
    case "payment": {
      const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, entityId));
      if (!p) throw new AccessError("Не найдено");
      if (p.orderId) await assertOrderAccess(u, p.orderId, write);
      else if (write && !can(u, PERMS.ordersEdit)) throw new AccessError();
      return;
    }
    case "supplier":
      if (write && !can(u, PERMS.ordersEdit) && !can(u, PERMS.suppliersEdit)) throw new AccessError();
      return;
    case "task": {
      const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
      if (!t) throw new AccessError("Не найдено");
      if (t.assigneeId !== u.id && t.creatorId !== u.id && !can(u, PERMS.tasksViewAll)) throw new AccessError();
      return;
    }
    default:
      throw new AccessError("Неверный объект");
  }
}

export function entityPath(type: string, id: string) {
  return { order: `/orders/${id}`, supplier: `/suppliers/${id}`, task: `/tasks/${id}` }[type] ?? "/";
}
