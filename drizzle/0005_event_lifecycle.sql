CREATE TABLE "event_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_status_history" ADD CONSTRAINT "event_status_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_status_history_event_idx" ON "event_status_history" USING btree ("event_id");