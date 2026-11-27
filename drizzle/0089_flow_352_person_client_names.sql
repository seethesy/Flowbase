-- FLOW-352 (A1): a Person client is named for its Primary POC contact. Person
-- clients whose name differs from their first live, named Primary POC take that
-- name; each rename writes an audit row (actor: the system, created_by NULL).
WITH "poc" AS (
  SELECT DISTINCT ON ("client_id") "client_id", btrim("name") AS "name"
  FROM "client_contacts"
  WHERE "role" = 'primary_poc' AND "archived_at" IS NULL AND btrim("name") <> ''
  ORDER BY "client_id", "sort_order", "created_at", "id"
), "renames" AS (
  SELECT "clients"."id", "clients"."name" AS "before", "poc"."name" AS "after"
  FROM "clients"
  INNER JOIN "poc" ON "poc"."client_id" = "clients"."id"
  WHERE "clients"."kind" = 'person' AND "clients"."name" <> "poc"."name"
), "audited" AS (
  INSERT INTO "audit_log" ("entity_type", "entity_id", "action", "changes")
  SELECT 'client', "id", 'update', jsonb_build_object('name', jsonb_build_object('before', "before", 'after', "after"))
  FROM "renames"
)
UPDATE "clients" SET "name" = "renames"."after", "updated_at" = now()
FROM "renames"
WHERE "clients"."id" = "renames"."id";
