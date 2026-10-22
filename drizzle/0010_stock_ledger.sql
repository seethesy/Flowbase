CREATE TABLE "inventory_bar_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"container" text,
	CONSTRAINT "inventory_bar_details_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_bar_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_cost_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"previous_cents" integer,
	"unit_cost_cents" integer,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_cost_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"movement_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"section_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_consumable_details" ADD COLUMN "storage_order" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "corrects_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "link_type" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_bar_details" ADD CONSTRAINT "inventory_bar_details_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_history" ADD CONSTRAINT "inventory_cost_history_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_section_id_inventory_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_cost_history_item_idx" ON "inventory_cost_history" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_item_idx" ON "stock_count_lines" USING btree ("count_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_open_section_idx" ON "stock_counts" USING btree ("section_id") WHERE "stock_counts"."status" = 'open';--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_section_id_inventory_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_corrects_id_stock_movements_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_corrects_idx" ON "stock_movements" USING btree ("corrects_id");--> statement-breakpoint
-- Existing movements become ledger rows (FLOW-71): each counted adjustment is a
-- count movement in its section, and each transfer becomes its incoming half plus
-- a new outgoing half sharing its transfer_id.
UPDATE "stock_movements" SET "reason" = "note";--> statement-breakpoint
UPDATE "stock_movements" SET "type" = 'count', "section_id" = "to_section_id" WHERE "type" = 'adjustment';--> statement-breakpoint
INSERT INTO "stock_movements" ("created_at", "updated_at", "created_by", "updated_by", "item_id", "section_id", "type", "quantity", "reason", "transfer_id")
	SELECT "created_at", "updated_at", "created_by", "updated_by", "item_id", "from_section_id", 'transfer', -"quantity", "note", "id"
	FROM "stock_movements" WHERE "type" = 'transfer';--> statement-breakpoint
UPDATE "stock_movements" SET "section_id" = "to_section_id", "transfer_id" = "id" WHERE "type" = 'transfer' AND "transfer_id" IS NULL;--> statement-breakpoint
-- Movements are append-only: corrections are new movements (FLOW-71 AC3).
CREATE FUNCTION "stock_movements_append_only"() RETURNS trigger
	LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
	RAISE EXCEPTION 'stock_movements is append-only; record a correcting movement instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "stock_movements_append_only"();
