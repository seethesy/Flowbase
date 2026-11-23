CREATE TABLE "google_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"refresh_token_cipher" text,
	"calendar_id" text,
	"needs_reconnect_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "google_calendar_event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"connection_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_calendar_event_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_event_links" ADD CONSTRAINT "google_calendar_event_links_connection_id_google_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_calendar_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_event_links" ADD CONSTRAINT "google_calendar_event_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_user_idx" ON "google_calendar_connections" USING btree ("user_id") WHERE "google_calendar_connections"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_links_event_idx" ON "google_calendar_event_links" USING btree ("connection_id","event_id") WHERE "google_calendar_event_links"."archived_at" is null;