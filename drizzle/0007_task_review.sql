ALTER TYPE "public"."task_status" ADD VALUE 'REVIEW' BEFORE 'DONE';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "submitted_at" timestamp with time zone;