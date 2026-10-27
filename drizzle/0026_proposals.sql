CREATE TABLE "proposal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"proposal_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"manual" boolean DEFAULT true NOT NULL,
	CONSTRAINT "proposal_stage_history_from_stage_check" CHECK ("proposal_stage_history"."from_stage" in ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'lost')),
	CONSTRAINT "proposal_stage_history_to_stage_check" CHECK ("proposal_stage_history"."to_stage" in ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'lost'))
);
--> statement-breakpoint
ALTER TABLE "proposal_stage_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"proposal_id" uuid NOT NULL,
	"number" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"docx" jsonb NOT NULL,
	"pdf" jsonb,
	"completed_at" timestamp with time zone,
	CONSTRAINT "proposal_versions_status_check" CHECK ("proposal_versions"."status" in ('pending', 'ready')),
	CONSTRAINT "proposal_versions_ready_numbered" CHECK ("proposal_versions"."status" = 'pending' or ("proposal_versions"."number" is not null and "proposal_versions"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "proposal_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assigned_salesperson_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'client_communication' NOT NULL,
	"lost_reason" text DEFAULT '' NOT NULL,
	"current_version_id" uuid,
	CONSTRAINT "proposals_stage_check" CHECK ("proposals"."stage" in ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'lost'))
);
--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposal_stage_history" ADD CONSTRAINT "proposal_stage_history_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_current_version_id_proposal_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_stage_history_proposal_idx" ON "proposal_stage_history" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_versions_number_idx" ON "proposal_versions" USING btree ("proposal_id","number");--> statement-breakpoint
CREATE INDEX "proposals_event_idx" ON "proposals" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "proposals_salesperson_idx" ON "proposals" USING btree ("assigned_salesperson_id");