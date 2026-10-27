DROP INDEX "inventory_stock_item_section_idx";--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "internal_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "replacement_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "dimensions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "colors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "assembly_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "buffer_days_before" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "buffer_days_after" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "components" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD COLUMN "priced_by_quote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD COLUMN "includes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD COLUMN "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD COLUMN "color" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "color" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_item_section_idx" ON "inventory_stock" USING btree ("item_id","section_id","color");