ALTER TABLE "list_values" DROP CONSTRAINT "list_values_list_key_check";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "approved_for_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "photo_date" date;--> statement-breakpoint
ALTER TABLE "list_values" ADD CONSTRAINT "list_values_list_key_check" CHECK ("list_values"."list_key" in ('staff_position', 'event_type', 'service_type', 'food_service_style', 'dress_code', 'lead_source', 'vehicle', 'recipe_category', 'allergen', 'dietary_tag', 'rental_category', 'decor_category', 'kitchen_equipment_category', 'ingredient_category', 'supply_category', 'photo_tag'));