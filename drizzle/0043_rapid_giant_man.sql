ALTER TABLE "addendums" ADD COLUMN "proposal_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD COLUMN "sent_method" text;--> statement-breakpoint
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;