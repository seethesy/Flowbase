ALTER TABLE "inventory_items" ADD COLUMN "subcategory" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "pull_owner" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_rental_details" ADD CONSTRAINT "inventory_rental_details_supplier_id_vendors_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_pull_owner_check" CHECK ("inventory_items"."pull_owner" in ('pull_lead', 'production_lead', 'sales_manager'));