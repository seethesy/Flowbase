CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"source_lead_id" text DEFAULT '' NOT NULL,
	"source_lead_url" text DEFAULT '' NOT NULL,
	"purchased" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"event_date" date,
	"guest_count" integer,
	"location" text DEFAULT '' NOT NULL,
	"event_type" text DEFAULT '' NOT NULL,
	"budget_cents" integer,
	"message" text DEFAULT '' NOT NULL,
	"raw_payload" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"lost_reason" text DEFAULT '' NOT NULL,
	"first_responded_at" timestamp with time zone,
	"assigned_salesperson_id" uuid,
	"converted_client_id" uuid,
	"converted_event_id" uuid
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_clients_id_fk" FOREIGN KEY ("converted_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_event_id_events_id_fk" FOREIGN KEY ("converted_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_received_at_idx" ON "leads" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_salesperson_idx" ON "leads" USING btree ("assigned_salesperson_id");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" USING btree ("source","source_lead_id");