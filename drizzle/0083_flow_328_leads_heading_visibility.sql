-- FLOW-328: Sales › Leads became Leads › Overview and Sales › Proposals moved to
-- Leads › Proposals. Each role keeps what the Admin hid (FLOW-284): the moved
-- tabs' keys follow them, and a role with the whole Sales heading hidden gets the
-- new Leads heading hidden too.
UPDATE "role_nav_hidden" SET "hidden" = (
  SELECT COALESCE(jsonb_agg(DISTINCT "keys"."key" ORDER BY "keys"."key"), '[]'::jsonb)
  FROM (
    SELECT CASE "item"
      WHEN 'sales.leads' THEN 'leads.overview'
      WHEN 'sales.proposals' THEN 'leads.proposals'
      ELSE "item" END AS "key"
    FROM jsonb_array_elements_text("role_nav_hidden"."hidden") AS "item"
    UNION
    SELECT 'leads' WHERE "role_nav_hidden"."hidden" @> '["sales"]'::jsonb
  ) AS "keys"
)
WHERE "hidden" @> '["sales"]'::jsonb
  OR "hidden" @> '["sales.leads"]'::jsonb
  OR "hidden" @> '["sales.proposals"]'::jsonb;
