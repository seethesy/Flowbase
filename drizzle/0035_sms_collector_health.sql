CREATE TABLE "collector_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"site" text NOT NULL,
	"no_leads_gap_hours" integer DEFAULT 48 NOT NULL,
	"failure_threshold" integer DEFAULT 3 NOT NULL,
	"alert_state" text DEFAULT 'ok' NOT NULL,
	CONSTRAINT "collector_sites_site_unique" UNIQUE("site")
);
--> statement-breakpoint
ALTER TABLE "collector_sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mobile" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"provider" text DEFAULT 'stub' NOT NULL,
	CONSTRAINT "sms_outbox_status_check" CHECK ("sms_outbox"."status" in ('recorded', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "sms_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_outbox_notification_idx" ON "sms_outbox" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "sms_outbox_created_idx" ON "sms_outbox" USING btree ("created_at");