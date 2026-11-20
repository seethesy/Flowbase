-- Let the generated schema migration replace the temporary broader checks.
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff', 'part_time_staff'));
UPDATE "users" SET "role" = 'part_time_staff' WHERE "role" = 'staff' AND "employment_type" = 'part_time';

ALTER TABLE "leads" DROP CONSTRAINT "leads_status_check";
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("status" IN ('new', 'contacted', 'qualified', 'converted', 'inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));
UPDATE "leads" AS l SET "status" = CASE
  WHEN l."status" = 'new' THEN 'inquiry'
  WHEN l."status" IN ('contacted', 'qualified') THEN 'pitching'
  WHEN l."status" = 'converted' AND EXISTS (
    SELECT 1 FROM "events" e WHERE e."id" = l."converted_event_id"
      AND e."status" IN ('closed', 'preparation', 'finished')
  ) THEN 'closed'
  WHEN l."status" = 'converted' THEN 'closing'
  ELSE l."status"
END WHERE l."status" IN ('new', 'contacted', 'qualified', 'converted');

-- Existing choices are intentionally reset. Confirm with Art before production rollout.
UPDATE "notification_preferences" SET "email" = false WHERE "email" = true;
