CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"recipe_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 4),
	"unit" text,
	"prep_note" text DEFAULT '' NOT NULL,
	"entered_cost_cents" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finishing_note" text DEFAULT '' NOT NULL,
	"yield_servings" numeric(14, 4),
	"portion_size" text DEFAULT '' NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dietary_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recipes_category_check" CHECK ("recipes"."category" in ('appetizers', 'mains', 'sides', 'desserts', 'drinks', 'additional_items'))
);
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_lines_recipe_idx" ON "recipe_lines" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_item_idx" ON "recipe_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "recipes_name_idx" ON "recipes" USING btree ("category",lower("name"));