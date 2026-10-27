CREATE TABLE "list_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"list_key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "list_values_list_key_check" CHECK ("list_values"."list_key" in ('staff_position', 'event_type', 'service_type', 'food_service_style', 'dress_code', 'lead_source', 'vehicle', 'recipe_category', 'rental_category', 'decor_category', 'kitchen_equipment_category', 'ingredient_category', 'supply_category'))
);
--> statement-breakpoint
ALTER TABLE "list_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key"),
	CONSTRAINT "settings_key_check" CHECK ("settings"."key" in ('company', 'defaults'))
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "positions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_consent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "list_values_list_idx" ON "list_values" USING btree ("list_key","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "list_values_label_idx" ON "list_values" USING btree ("list_key",lower("label")) WHERE "list_values"."archived_at" is null;