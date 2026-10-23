CREATE TABLE "lead_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"lead_id" uuid NOT NULL,
	"matched_lead_id" uuid,
	"matched_client_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "lead_duplicates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_into_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_by" uuid;--> statement-breakpoint
ALTER TABLE "lead_duplicates" ADD CONSTRAINT "lead_duplicates_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_duplicates" ADD CONSTRAINT "lead_duplicates_matched_lead_id_leads_id_fk" FOREIGN KEY ("matched_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_duplicates" ADD CONSTRAINT "lead_duplicates_matched_client_id_clients_id_fk" FOREIGN KEY ("matched_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_duplicates_lead_idx" ON "lead_duplicates" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_duplicates_matched_lead_idx" ON "lead_duplicates" USING btree ("matched_lead_id");--> statement-breakpoint
CREATE INDEX "lead_duplicates_status_idx" ON "lead_duplicates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_duplicates_lead_pair_idx" ON "lead_duplicates" USING btree ("lead_id","matched_lead_id") WHERE "lead_duplicates"."matched_lead_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_duplicates_client_pair_idx" ON "lead_duplicates" USING btree ("lead_id","matched_client_id") WHERE "lead_duplicates"."matched_client_id" is not null;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_lead_id_leads_id_fk" FOREIGN KEY ("merged_into_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;