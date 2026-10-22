ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_from_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_to_section_id_inventory_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "section_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "from_section_id";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "to_section_id";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "note";