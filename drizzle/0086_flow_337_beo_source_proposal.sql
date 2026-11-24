ALTER TABLE "beos" ADD COLUMN "source_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "beos" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "beos" ADD CONSTRAINT "beos_source_proposal_id_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beos" ADD CONSTRAINT "beos_source_version_id_proposal_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;