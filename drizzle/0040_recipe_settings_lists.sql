-- FLOW-218: recipe categories, allergens and dietary tags come from the settings
-- lists recipe_category, allergen and dietary_tag. A dish stores the label it was
-- saved with, so the built-in codes it holds now are rewritten to those labels and
-- the lists are seeded with the same values: every dish keeps its category,
-- allergens and tags.
ALTER TABLE "list_values" DROP CONSTRAINT "list_values_list_key_check";--> statement-breakpoint
ALTER TABLE "recipes" DROP CONSTRAINT "recipes_category_check";--> statement-breakpoint
ALTER TABLE "list_values" ADD CONSTRAINT "list_values_list_key_check" CHECK ("list_values"."list_key" in ('staff_position', 'event_type', 'service_type', 'food_service_style', 'dress_code', 'lead_source', 'vehicle', 'recipe_category', 'allergen', 'dietary_tag', 'rental_category', 'decor_category', 'kitchen_equipment_category', 'ingredient_category', 'supply_category'));--> statement-breakpoint
UPDATE "recipes" SET "category" = CASE "category"
	WHEN 'appetizers' THEN 'Appetizers'
	WHEN 'mains' THEN 'Mains'
	WHEN 'sides' THEN 'Sides'
	WHEN 'desserts' THEN 'Desserts'
	WHEN 'drinks' THEN 'Drinks'
	WHEN 'additional_items' THEN 'Additional items'
	ELSE "category"
END;--> statement-breakpoint
UPDATE "recipes" SET "allergens" = (
	SELECT COALESCE(jsonb_agg(
		CASE "code"
			WHEN 'milk' THEN 'Milk'
			WHEN 'eggs' THEN 'Eggs'
			WHEN 'fish' THEN 'Fish'
			WHEN 'shellfish' THEN 'Shellfish'
			WHEN 'tree_nuts' THEN 'Tree nuts'
			WHEN 'peanuts' THEN 'Peanuts'
			WHEN 'wheat' THEN 'Wheat'
			WHEN 'soy' THEN 'Soy'
			WHEN 'sesame' THEN 'Sesame'
			ELSE "code"
		END ORDER BY "position"), '[]'::jsonb)
	FROM jsonb_array_elements_text("recipes"."allergens") WITH ORDINALITY AS "element"("code", "position")
)
WHERE jsonb_array_length("allergens") > 0;--> statement-breakpoint
UPDATE "recipes" SET "dietary_tags" = (
	SELECT COALESCE(jsonb_agg(
		CASE "code"
			WHEN 'vegan' THEN 'Vegan'
			WHEN 'vegetarian' THEN 'Vegetarian'
			WHEN 'gluten_free' THEN 'Gluten-free'
			WHEN 'dairy_free' THEN 'Dairy-free'
			ELSE "code"
		END ORDER BY "position"), '[]'::jsonb)
	FROM jsonb_array_elements_text("recipes"."dietary_tags") WITH ORDINALITY AS "element"("code", "position")
)
WHERE jsonb_array_length("dietary_tags") > 0;--> statement-breakpoint
INSERT INTO "list_values" ("list_key", "label", "sort_order")
SELECT "seed"."list_key", "seed"."label", "seed"."sort_order"
FROM (VALUES
	('recipe_category', 'Appetizers', 0),
	('recipe_category', 'Mains', 1),
	('recipe_category', 'Sides', 2),
	('recipe_category', 'Desserts', 3),
	('recipe_category', 'Drinks', 4),
	('recipe_category', 'Additional items', 5),
	('allergen', 'Milk', 0),
	('allergen', 'Eggs', 1),
	('allergen', 'Fish', 2),
	('allergen', 'Shellfish', 3),
	('allergen', 'Tree nuts', 4),
	('allergen', 'Peanuts', 5),
	('allergen', 'Wheat', 6),
	('allergen', 'Soy', 7),
	('allergen', 'Sesame', 8),
	('dietary_tag', 'Vegan', 0),
	('dietary_tag', 'Vegetarian', 1),
	('dietary_tag', 'Gluten-free', 2),
	('dietary_tag', 'Dairy-free', 3)
) AS "seed"("list_key", "label", "sort_order")
WHERE NOT EXISTS (
	SELECT 1 FROM "list_values"
	WHERE "list_values"."list_key" = "seed"."list_key"
		AND lower("list_values"."label") = lower("seed"."label")
		AND "list_values"."archived_at" IS NULL
);
