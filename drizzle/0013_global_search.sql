-- Global search (FLOW-46): pg_trgm for fuzzy matching. Supabase ships it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "phone_digits" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Digits only, without a leading US country code (worker/records/sync.ts phoneDigits).
UPDATE "leads" SET "phone_digits" = regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^1(\d{10})$', '\1');--> statement-breakpoint
CREATE INDEX "client_contacts_name_trgm_idx" ON "client_contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_name_trgm_idx" ON "clients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "events_title_trgm_idx" ON "events" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "inventory_items_name_trgm_idx" ON "inventory_items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone_digits");--> statement-breakpoint
CREATE INDEX "leads_name_trgm_idx" ON "leads" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "venues_name_trgm_idx" ON "venues" USING gin ("name" gin_trgm_ops);