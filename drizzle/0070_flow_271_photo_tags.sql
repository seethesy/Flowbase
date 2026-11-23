-- Marketing photo tags (FLOW-271): the same values as defaultPhotoTags in
-- shared/photos.ts. Admin changes them on the Settings screen.
INSERT INTO "list_values" ("list_key", "label", "sort_order") VALUES
	('photo_tag', 'Food', 0),
	('photo_tag', 'Venue', 1),
	('photo_tag', 'Decor', 2),
	('photo_tag', 'Setup', 3),
	('photo_tag', 'Bar', 4),
	('photo_tag', 'Team', 5);
