CREATE TABLE "day_of_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"reached_at" timestamp with time zone,
	"reached_by" uuid,
	CONSTRAINT "day_of_checkpoints_key_check" CHECK ("day_of_checkpoints"."key" in ('food_left_kitchen', 'arrived_at_venue', 'service_started', 'service_ended'))
);
--> statement-breakpoint
ALTER TABLE "day_of_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "day_of_staff_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"slot_id" uuid NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	CONSTRAINT "day_of_staff_states_slot_id_unique" UNIQUE("slot_id"),
	CONSTRAINT "day_of_staff_states_status_check" CHECK ("day_of_staff_states"."status" in ('scheduled', 'en_route', 'on_site', 'working', 'on_break', 'done'))
);
--> statement-breakpoint
ALTER TABLE "day_of_staff_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "day_of_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"truck_id" uuid,
	"slot_id" uuid,
	"subject_name" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	CONSTRAINT "day_of_updates_kind_check" CHECK ("day_of_updates"."kind" in ('staff', 'truck', 'checkpoint'))
);
--> statement-breakpoint
ALTER TABLE "day_of_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "day_of_checkpoints" ADD CONSTRAINT "day_of_checkpoints_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_of_staff_states" ADD CONSTRAINT "day_of_staff_states_slot_id_event_staff_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."event_staff_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_of_updates" ADD CONSTRAINT "day_of_updates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_of_updates" ADD CONSTRAINT "day_of_updates_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_of_updates" ADD CONSTRAINT "day_of_updates_slot_id_event_staff_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."event_staff_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_of_checkpoints_event_key_idx" ON "day_of_checkpoints" USING btree ("event_id","key");--> statement-breakpoint
CREATE INDEX "day_of_updates_event_idx" ON "day_of_updates" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "day_of_updates_truck_idx" ON "day_of_updates" USING btree ("truck_id","created_at");