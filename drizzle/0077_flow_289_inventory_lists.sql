CREATE TABLE "bar_inventory_items" (
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
	"category_id" uuid,
	"type_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"pull_owner" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"ratio_quantity" numeric(14, 4),
	"ratio_basis" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "bar_inventory_items_kind_check" CHECK ("bar_inventory_items"."kind" in ('rental', 'consumable', 'service')),
	CONSTRAINT "bar_inventory_items_ratio_basis_check" CHECK ("bar_inventory_items"."ratio_basis" in ('per_guest', 'per_table', 'per_event')),
	CONSTRAINT "bar_inventory_items_pull_owner_check" CHECK ("bar_inventory_items"."pull_owner" in ('pull_lead', 'production_lead', 'sales_manager')),
	CONSTRAINT "bar_inventory_items_list_check" CHECK (kind = 'consumable' and subtype = 'bar')
);
--> statement-breakpoint
ALTER TABLE "bar_inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_locations_kind_check" CHECK ("inventory_locations"."kind" in ('location', 'storage'))
);
--> statement-breakpoint
ALTER TABLE "inventory_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kitchen_ingredients" (
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
	"category_id" uuid,
	"type_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"pull_owner" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"ratio_quantity" numeric(14, 4),
	"ratio_basis" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "kitchen_ingredients_kind_check" CHECK ("kitchen_ingredients"."kind" in ('rental', 'consumable', 'service')),
	CONSTRAINT "kitchen_ingredients_ratio_basis_check" CHECK ("kitchen_ingredients"."ratio_basis" in ('per_guest', 'per_table', 'per_event')),
	CONSTRAINT "kitchen_ingredients_pull_owner_check" CHECK ("kitchen_ingredients"."pull_owner" in ('pull_lead', 'production_lead', 'sales_manager')),
	CONSTRAINT "kitchen_ingredients_list_check" CHECK (kind = 'consumable' and subtype = 'ingredient')
);
--> statement-breakpoint
ALTER TABLE "kitchen_ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "master_inventory_items" (
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
	"category_id" uuid,
	"type_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"pull_owner" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"ratio_quantity" numeric(14, 4),
	"ratio_basis" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "master_inventory_items_kind_check" CHECK ("master_inventory_items"."kind" in ('rental', 'consumable', 'service')),
	CONSTRAINT "master_inventory_items_ratio_basis_check" CHECK ("master_inventory_items"."ratio_basis" in ('per_guest', 'per_table', 'per_event')),
	CONSTRAINT "master_inventory_items_pull_owner_check" CHECK ("master_inventory_items"."pull_owner" in ('pull_lead', 'production_lead', 'sales_manager')),
	CONSTRAINT "master_inventory_items_list_check" CHECK (kind <> 'consumable' or subtype = 'supply')
);
--> statement-breakpoint
ALTER TABLE "master_inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closeout_lines" DROP CONSTRAINT "closeout_lines_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "consumable_allocations" DROP CONSTRAINT "consumable_allocations_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "event_bar_tiers" DROP CONSTRAINT "event_bar_tiers_reorder_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "event_requirements" DROP CONSTRAINT "event_requirements_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_bar_details" DROP CONSTRAINT "inventory_bar_details_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" DROP CONSTRAINT "inventory_consumable_details_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" DROP CONSTRAINT "inventory_consumable_details_storage_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_cost_history" DROP CONSTRAINT "inventory_cost_history_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_rental_details" DROP CONSTRAINT "inventory_rental_details_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_service_details" DROP CONSTRAINT "inventory_service_details_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_stock" DROP CONSTRAINT "inventory_stock_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_stock" DROP CONSTRAINT "inventory_stock_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_list_lines" DROP CONSTRAINT "pull_list_lines_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_list_lines" DROP CONSTRAINT "pull_list_lines_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP CONSTRAINT "recipe_lines_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "reservation_conflicts" DROP CONSTRAINT "reservation_conflicts_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_counts" DROP CONSTRAINT "stock_counts_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "bar_inventory_items" ADD CONSTRAINT "bar_inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bar_inventory_items" ADD CONSTRAINT "bar_inventory_items_type_id_inventory_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inventory_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ingredients" ADD CONSTRAINT "kitchen_ingredients_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ingredients" ADD CONSTRAINT "kitchen_ingredients_type_id_inventory_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inventory_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_inventory_items" ADD CONSTRAINT "master_inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_inventory_items" ADD CONSTRAINT "master_inventory_items_type_id_inventory_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inventory_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bar_inventory_items_kind_idx" ON "bar_inventory_items" USING btree ("kind","subtype");--> statement-breakpoint
CREATE UNIQUE INDEX "bar_inventory_items_code_idx" ON "bar_inventory_items" USING btree ("code") WHERE "bar_inventory_items"."code" <> '' and "bar_inventory_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "bar_inventory_items_name_trgm_idx" ON "bar_inventory_items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "kitchen_ingredients_kind_idx" ON "kitchen_ingredients" USING btree ("kind","subtype");--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_ingredients_code_idx" ON "kitchen_ingredients" USING btree ("code") WHERE "kitchen_ingredients"."code" <> '' and "kitchen_ingredients"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "kitchen_ingredients_name_trgm_idx" ON "kitchen_ingredients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "master_inventory_items_kind_idx" ON "master_inventory_items" USING btree ("kind","subtype");--> statement-breakpoint
CREATE UNIQUE INDEX "master_inventory_items_code_idx" ON "master_inventory_items" USING btree ("code") WHERE "master_inventory_items"."code" <> '' and "master_inventory_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "master_inventory_items_name_trgm_idx" ON "master_inventory_items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "closeout_lines" ADD CONSTRAINT "closeout_lines_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_bar_tiers" ADD CONSTRAINT "event_bar_tiers_reorder_item_id_bar_inventory_items_id_fk" FOREIGN KEY ("reorder_item_id") REFERENCES "public"."bar_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_bar_details" ADD CONSTRAINT "inventory_bar_details_item_id_bar_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bar_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD CONSTRAINT "inventory_consumable_details_storage_section_id_inventory_locations_id_fk" FOREIGN KEY ("storage_section_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD CONSTRAINT "inventory_rental_details_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD CONSTRAINT "inventory_service_details_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_section_id_inventory_locations_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_section_id_inventory_locations_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_conflicts" ADD CONSTRAINT "reservation_conflicts_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_master_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."master_inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_section_id_inventory_locations_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_section_id_inventory_locations_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE VIEW "public"."all_inventory_items" WITH (security_invoker = true) AS (select * from "master_inventory_items" union all select * from "bar_inventory_items" union all select * from "kitchen_ingredients");