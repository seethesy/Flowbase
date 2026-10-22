CREATE TABLE "activity_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"client_session_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"record_type" text,
	"record_id" uuid,
	"activity" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_sessions_client_session_idx" ON "activity_sessions" USING btree ("user_id","client_session_id");--> statement-breakpoint
CREATE INDEX "activity_sessions_started_idx" ON "activity_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "activity_sessions_record_idx" ON "activity_sessions" USING btree ("record_type","record_id");