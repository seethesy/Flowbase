CREATE TABLE "collector_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"run_id" uuid NOT NULL,
	"site" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"leads_found" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"message" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collector_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "collector_runs_run_site_idx" ON "collector_runs" USING btree ("run_id","site");--> statement-breakpoint
CREATE INDEX "collector_runs_site_started_idx" ON "collector_runs" USING btree ("site","started_at");