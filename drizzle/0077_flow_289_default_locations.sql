-- Default locations (FLOW-289). Admin can add, rename, reorder and archive them in
-- Settings › Locations. Kitchen ingredients keep their own storage list.
INSERT INTO "inventory_locations" ("name", "kind", "sort_order") VALUES
	('Warehouse', 'location', 0),
	('Storage Box', 'location', 1),
	('Jamie''s - Garage', 'location', 2),
	('Jamie''s - Basement', 'location', 3),
	('Jamie''s - Main Floor', 'location', 4),
	('Cozy Cafe', 'location', 5),
	('Vendor', 'location', 6),
	('Fridge', 'storage', 0),
	('Freezer', 'storage', 1),
	('Pantry', 'storage', 2);
