CREATE TABLE "inventory_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_types" ADD CONSTRAINT "inventory_types_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_categories_kind_name_idx" ON "inventory_categories" USING btree ("kind",lower("name")) WHERE "inventory_categories"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_types_category_name_idx" ON "inventory_types" USING btree ("category_id",lower("name")) WHERE "inventory_types"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_type_id_inventory_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inventory_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "inventory_categories" ("kind", "name", "sort_order") VALUES
  ('rental', 'Equipment', 0), ('rental', 'Furniture', 1),
  ('rental', 'Linen', 2), ('rental', 'Tableware', 3),
  ('rental', 'Glassware', 4), ('rental', 'Bar', 5), ('rental', 'Decor', 6),
  ('ingredient', 'Ingredient', 0), ('bar', 'Bar', 0),
  ('supply', 'Supply', 0), ('service', 'Services', 0);
--> statement-breakpoint
UPDATE "inventory_items" AS item SET "category_id" = category.id
FROM "inventory_categories" AS category
WHERE category.kind = CASE WHEN item.kind = 'consumable' THEN item.subtype ELSE item.kind END
  AND lower(category.name) = CASE WHEN item.kind = 'service' THEN 'services' ELSE lower(item.subtype) END;
