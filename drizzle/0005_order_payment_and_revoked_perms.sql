CREATE TYPE "public"."order_pay_method" AS ENUM('BANK', 'CASH', 'MIXED');--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "payment_method" "order_pay_method";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cash_planned" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "revoked_permissions" text[] DEFAULT '{}'::text[] NOT NULL;