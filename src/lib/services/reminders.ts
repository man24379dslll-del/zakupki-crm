import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Напоминания о сроках задач. Вызывается при открытии любой страницы пользователем
 * (не требует отдельного планировщика): задачи со сроком в ближайшие 24 часа или просроченные,
 * по которым ещё не напоминали, получают уведомление один раз.
 */
export async function ensureTaskReminders(userId: string) {
  await db.execute(sql`
    WITH due AS (
      UPDATE tasks SET reminded_at = now()
      WHERE assignee_id = ${userId} AND deleted_at IS NULL AND status NOT IN ('DONE','CANCELLED')
        AND due_date IS NOT NULL AND due_date < now() + interval '24 hours' AND reminded_at IS NULL
      RETURNING id, title, due_date
    )
    INSERT INTO notifications (user_id, type, title, body, link)
    SELECT ${userId}, 'task_due',
      CASE WHEN due_date < now() THEN 'Задача просрочена' ELSE 'Срок задачи истекает' END,
      title, '/tasks/' || id FROM due`);
}
