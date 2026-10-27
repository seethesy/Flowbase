CREATE TABLE "event_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"activities" text DEFAULT '' NOT NULL,
	CONSTRAINT "event_shifts_kind_check" CHECK ("event_shifts"."kind" in ('pull_load', 'setup', 'event_day')),
	CONSTRAINT "event_shifts_ends_after_start" CHECK ("event_shifts"."ends_at" > "event_shifts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "event_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_staff_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"shift_id" uuid NOT NULL,
	"position" text NOT NULL,
	"department" text NOT NULL,
	"assignee_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_staff_slots_department_check" CHECK ("event_staff_slots"."department" in ('management', 'kitchen', 'service', 'bar', 'decor_setup', 'pull_load', 'transport', 'other'))
);
--> statement-breakpoint
ALTER TABLE "event_staff_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "arrives_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_shifts" ADD CONSTRAINT "event_shifts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_slots" ADD CONSTRAINT "event_staff_slots_shift_id_event_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."event_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_slots" ADD CONSTRAINT "event_staff_slots_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_shifts_event_idx" ON "event_shifts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_staff_slots_shift_idx" ON "event_staff_slots" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "event_staff_slots_assignee_idx" ON "event_staff_slots" USING btree ("assignee_id");