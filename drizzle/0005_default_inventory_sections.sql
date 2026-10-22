-- Default inventory sections (FLOW-70). Admin can rename or archive them later.
INSERT INTO "inventory_sections" ("name", "kind", "sort_order") VALUES
	('Warehouse', 'rental', 0),
	('Jamie''s', 'rental', 1),
	('Cafe', 'rental', 2),
	('Vendor', 'rental', 3),
	('Kitchen – Dry Storage', 'consumable', 0),
	('Kitchen – Refrigerated', 'consumable', 1),
	('Kitchen – Freezer', 'consumable', 2),
	('Bar Storage', 'consumable', 3),
	('Supplies', 'consumable', 4);
