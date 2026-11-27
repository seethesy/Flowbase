-- FLOW-339/342: carry hidden moved tabs to their new headings.
UPDATE "role_nav_hidden" SET "hidden" = (
  SELECT COALESCE(jsonb_agg(DISTINCT "keys"."key" ORDER BY "keys"."key"), '[]'::jsonb)
  FROM (
    SELECT "item" AS "key" FROM jsonb_array_elements_text("role_nav_hidden"."hidden") AS "item"
    WHERE "item" NOT IN ('events.beos', 'reports', 'reports.overview', 'reports.time-tracking', 'reports.operational-reports')
    UNION
    SELECT 'leads.beos' WHERE "role_nav_hidden"."hidden" ?| ARRAY['events', 'events.beos']
    UNION
    SELECT 'sales.time-tracking' WHERE
      "role_nav_hidden"."hidden" ? 'reports'
      OR ("role_nav_hidden"."hidden" ? 'reports.time-tracking'
        AND "role_nav_hidden"."hidden" ? 'reports.operational-reports')
  ) AS "keys"
)
WHERE "hidden" ?| ARRAY['events', 'events.beos', 'reports', 'reports.overview', 'reports.time-tracking', 'reports.operational-reports'];
