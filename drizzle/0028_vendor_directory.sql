CREATE TABLE "vendor_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"portal_url" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"order_cutoff" text DEFAULT '' NOT NULL,
	"delivery_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minimum_order_cents" integer,
	"lead_time_days" integer,
	"ordering_instructions" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "vendors_type_check" CHECK ("vendors"."type" in ('food_distributor', 'beverage_distributor', 'rental_vendor', 'event_partner'))
);
--> statement-breakpoint
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD COLUMN "preferred_vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "vendor_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_contacts_vendor_idx" ON "vendor_contacts" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_idx" ON "vendors" USING btree (lower("name")) WHERE "vendors"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "vendors_name_trgm_idx" ON "vendors" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD CONSTRAINT "inventory_consumable_details_preferred_vendor_id_vendors_id_fk" FOREIGN KEY ("preferred_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD CONSTRAINT "inventory_rental_details_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;