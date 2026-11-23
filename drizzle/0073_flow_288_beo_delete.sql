ALTER TABLE "beos" DROP CONSTRAINT "beos_event_id_unique";--> statement-breakpoint
ALTER TABLE "deletions" DROP CONSTRAINT "deletions_entity_type_check";--> statement-breakpoint
CREATE UNIQUE INDEX "beos_event_live_idx" ON "beos" USING btree ("event_id") WHERE "beos"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "deletions" ADD CONSTRAINT "deletions_entity_type_check" CHECK ("deletions"."entity_type" in ('lead', 'client', 'venue', 'event', 'vendor', 'inventory_item', 'recipe', 'staff_member', 'sop', 'beo'));