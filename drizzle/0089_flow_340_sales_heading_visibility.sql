-- FLOW-340: Sales › Clients and Sales › Venues became Sales › Network, and
-- Sales › Sales tracker became Sales › Analytics. A role that had any of them
-- hidden (FLOW-284) has the tab that replaced it hidden.
UPDATE "role_nav_hidden" SET "hidden" = (
  SELECT COALESCE(jsonb_agg(DISTINCT "keys"."key" ORDER BY "keys"."key"), '[]'::jsonb)
  FROM (
    SELECT CASE "item"
      WHEN 'sales.clients' THEN 'sales.network'
      WHEN 'sales.venues' THEN 'sales.network'
      WHEN 'sales.sales-tracker' THEN 'sales.analytics'
      ELSE "item" END AS "key"
    FROM jsonb_array_elements_text("role_nav_hidden"."hidden") AS "item"
  ) AS "keys"
)
WHERE "hidden" ?| ARRAY['sales.clients', 'sales.venues', 'sales.sales-tracker'];
