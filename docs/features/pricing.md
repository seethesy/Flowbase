## Pricing

Sales › Pricing (`/sales/pricing`, FLOW-329; `src/features/sales/pricing.tsx`, API `worker/routes/sales/pricing.ts` at `/api/pricing`, logic in `worker/records/sales/pricing.ts`, schemas in `shared/pricing.ts`) is the price list salespeople quote from. The Admin keeps it on the tab (FLOW-329 A1: an Admin-managed table, not built from inventory prices).

- **Table** `price_list_items`: `name`, `category` (`package`, `per_guest_rate`, `minimum`, `fee`), `basis` (`per_event`, `per_guest`, `per_hour`, `per_item`, `percent`), `amount` and `description`. `amount` is cents, or hundredths of a percent when the basis is `percent` (1800 = 18% of the event total). Archived rows drop off the list.
- **Who:** roles that read proposals (`proposals.read`) see the tab and `GET /api/pricing` (A2); only `settings.manage` (Admin) may `POST /`, `PUT /<id>` and `POST /<id>/archive|restore`. Each change is audit-logged as `price_list_item`.
- **Screen:** prices are grouped by category, then by name, with search and a category filter. The Admin adds and edits a price in a drawer (amounts in dollars, or percent for a percent fee) and archives one from its row. The page layout key is `sales.pricing` (block `price-list`).
- Not yet: prices aren't pulled into proposals, and there are no package line items or per-guest tiers within one price.
