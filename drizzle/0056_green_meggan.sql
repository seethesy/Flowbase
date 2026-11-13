CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"lead_id" uuid,
	"client_id" uuid,
	"event_id" uuid,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"follow_up_date" date,
	"follow_up_task_id" uuid,
	CONSTRAINT "communications_kind_check" CHECK ("communications"."kind" in ('call', 'email', 'text', 'meeting', 'note')),
	CONSTRAINT "communications_one_record_check" CHECK (num_nonnulls("communications"."lead_id", "communications"."client_id", "communications"."event_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "communications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "communications_lead_idx" ON "communications" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communications_client_idx" ON "communications" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communications_event_idx" ON "communications" USING btree ("event_id","occurred_at");