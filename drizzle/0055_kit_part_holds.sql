DROP INDEX "reservations_event_item_idx";--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "kit_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_kit_reservation_id_reservations_id_fk" FOREIGN KEY ("kit_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_event_item_idx" ON "reservations" USING btree ("event_id","item_id") WHERE "reservations"."archived_at" is null and "reservations"."kit_reservation_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_kit_item_idx" ON "reservations" USING btree ("kit_reservation_id","item_id") WHERE "reservations"."archived_at" is null and "reservations"."kit_reservation_id" is not null;
