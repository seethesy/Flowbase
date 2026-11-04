CREATE TABLE "vendor_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"order_list_id" uuid NOT NULL,
	"vendor_id" uuid,
	"vendor_name" text NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"portal_order_number" text NOT NULL,
	"ordered_on" date NOT NULL,
	"expected_delivery" date NOT NULL,
	"total_cents" integer,
	"notes" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "vendor_orders_status_check" CHECK ("vendor_orders"."status" in ('ordered', 'partially_received', 'received', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "vendor_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_lists" DROP CONSTRAINT "order_lists_status_check";--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_order_list_id_order_lists_id_fk" FOREIGN KEY ("order_list_id") REFERENCES "public"."order_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_orders_list_idx" ON "vendor_orders" USING btree ("order_list_id");--> statement-breakpoint
CREATE INDEX "vendor_orders_open_idx" ON "vendor_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_orders_active_vendor_idx" ON "vendor_orders" USING btree ("order_list_id","vendor_name") WHERE "vendor_orders"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "order_lists" ADD CONSTRAINT "order_lists_status_check" CHECK ("order_lists"."status" in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'partially_received', 'received', 'cancelled'));