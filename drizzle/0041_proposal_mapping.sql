CREATE TABLE "proposal_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_staff_slots" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "event_staff_slots" ADD COLUMN "proposal_slot_key" text;--> statement-breakpoint
ALTER TABLE "proposal_mappings" ADD CONSTRAINT "proposal_mappings_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_mappings" ADD CONSTRAINT "proposal_mappings_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_mappings_proposal_idx" ON "proposal_mappings" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "event_staff_slots" ADD CONSTRAINT "event_staff_slots_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_staff_slots_proposal_key_idx" ON "event_staff_slots" USING btree ("proposal_id","proposal_slot_key") WHERE "event_staff_slots"."proposal_slot_key" is not null and "event_staff_slots"."archived_at" is null;