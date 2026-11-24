CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"basis" text NOT NULL,
	"amount" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "price_list_items_category_check" CHECK ("price_list_items"."category" in ('package', 'per_guest_rate', 'minimum', 'fee')),
	CONSTRAINT "price_list_items_basis_check" CHECK ("price_list_items"."basis" in ('per_event', 'per_guest', 'per_hour', 'per_item', 'percent')),
	CONSTRAINT "price_list_items_amount_check" CHECK ("price_list_items"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "price_list_items" ENABLE ROW LEVEL SECURITY;