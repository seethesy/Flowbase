CREATE TABLE "inventory_consumable_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"purchase_unit" text NOT NULL,
	"pack_count" integer,
	"each_size_quantity" numeric(14, 4),
	"each_size_unit" text,
	"recipe_unit" text,
	"unit_cost_cents" integer,
	"preferred_vendor" text DEFAULT '' NOT NULL,
	"par_level" numeric(14, 4),
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_section_id" uuid,
	CONSTRAINT "inventory_consumable_details_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"kind" text NOT NULL,
	"subtype" text,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"ratio_quantity" numeric(14, 4),
	"ratio_basis" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_rental_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"price_cents" integer,
	CONSTRAINT "inventory_rental_details_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_service_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"price_cents" integer,
	"price_basis" text DEFAULT 'per_event' NOT NULL,
	CONSTRAINT "inventory_service_details_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_service_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"quantity" numeric(14, 4) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"from_section_id" uuid,
	"to_section_id" uuid,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD CONSTRAINT "inventory_consumable_details_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD CONSTRAINT "inventory_consumable_details_storage_section_id_inventory_sections_id_fk" FOREIGN KEY ("storage_section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD CONSTRAINT "inventory_rental_details_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD CONSTRAINT "inventory_service_details_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_section_id_inventory_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_section_id_inventory_sections_id_fk" FOREIGN KEY ("from_section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_section_id_inventory_sections_id_fk" FOREIGN KEY ("to_section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_kind_idx" ON "inventory_items" USING btree ("kind","subtype");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_code_idx" ON "inventory_items" USING btree ("code") WHERE "inventory_items"."code" <> '' and "inventory_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_item_section_idx" ON "inventory_stock" USING btree ("item_id","section_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_section_idx" ON "inventory_stock" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("item_id");