-- FLOW-289: inventory starts empty. The three inventory lists replace
-- inventory_items, and locations replace sections, so every current item, section
-- and row that points at one is deleted; Admin re-imports from Settings › Imports
-- (FLOW-290). Approved for dev and production: the data is test data (Art,
-- 2026-11-23). Recipes stay, without ingredient lines; bar plans by tier go with
-- the drinks they reorder. TRUNCATE skips the stock ledger's append-only trigger,
-- which fires on UPDATE and DELETE only, and fails if a table outside this list
-- still references one of these.
TRUNCATE TABLE
	"closeout_lines",
	"event_closeouts",
	"pull_list_lines",
	"pull_lists",
	"stock_count_lines",
	"stock_counts",
	"stock_movements",
	"inventory_stock",
	"inventory_cost_history",
	"inventory_rental_details",
	"inventory_service_details",
	"inventory_consumable_details",
	"inventory_bar_details",
	"recipe_lines",
	"reservation_conflicts",
	"reservations",
	"event_requirements",
	"consumable_allocations",
	"event_bar_tiers",
	"vendor_orders",
	"order_lists",
	"inventory_items",
	"inventory_sections";
--> statement-breakpoint
-- Rows that point at an item without a foreign key.
UPDATE "tasks" SET "inventory_item_id" = NULL WHERE "inventory_item_id" IS NOT NULL;
--> statement-breakpoint
-- Rental requests and sub-rentals to vendors (FLOW-75/157) followed the holds.
UPDATE "events" SET "rental_requests" = '[]'::jsonb WHERE "rental_requests" <> '[]'::jsonb;
--> statement-breakpoint
-- Confirmed proposal lines keep their text but lose the catalog item they named.
UPDATE "proposal_mappings" SET "data" = jsonb_set("data", '{lines}', (
	SELECT coalesce(jsonb_agg(line || '{"catalogId": null}'::jsonb), '[]'::jsonb)
	FROM jsonb_array_elements("data"->'lines') AS line
)) WHERE jsonb_typeof("data"->'lines') = 'array';
--> statement-breakpoint
UPDATE "proposal_version_mappings" SET "data" = jsonb_set("data", '{lines}', (
	SELECT coalesce(jsonb_agg(line || '{"catalogId": null}'::jsonb), '[]'::jsonb)
	FROM jsonb_array_elements("data"->'lines') AS line
)) WHERE jsonb_typeof("data"->'lines') = 'array';
--> statement-breakpoint
-- Pending requests for deleted order lists and Master inventory batches can't be
-- decided any more.
UPDATE "approval_requests" SET "status" = 'withdrawn', "updated_at" = now()
	WHERE "status" = 'pending' AND "subject_type" IN ('order_list', 'inventory_batch');
