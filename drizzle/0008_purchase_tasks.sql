CREATE TABLE "task_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(16, 3) NOT NULL,
	"target_price" numeric(16, 4),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_orders" (
	"task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"linked_by_id" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_orders_task_id_order_id_pk" PRIMARY KEY("task_id","order_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_items" ADD CONSTRAINT "task_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_items" ADD CONSTRAINT "task_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_orders" ADD CONSTRAINT "task_orders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_orders" ADD CONSTRAINT "task_orders_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_orders" ADD CONSTRAINT "task_orders_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_items_task_idx" ON "task_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_orders_order_idx" ON "task_orders" USING btree ("order_id");