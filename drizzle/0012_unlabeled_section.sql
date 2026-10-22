-- Rentals with no location label are kept in Unlabeled until someone places them.
INSERT INTO "inventory_sections" ("name", "kind", "sort_order")
	SELECT 'Unlabeled', 'rental', 4
	WHERE NOT EXISTS (
		SELECT 1 FROM "inventory_sections" WHERE "name" = 'Unlabeled'
	);
