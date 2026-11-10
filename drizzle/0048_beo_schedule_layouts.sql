CREATE TABLE "beo_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"beo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"scene" jsonb,
	CONSTRAINT "beo_areas_kind_check" CHECK ("beo_areas"."kind" in ('setup', 'layout'))
);
--> statement-breakpoint
ALTER TABLE "beo_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beo_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"beo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"section" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"checked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "beo_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beo_run_of_show" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"beo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"time" text NOT NULL,
	"cue" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beo_run_of_show" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "beos" ADD COLUMN "run_of_show_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "beo_areas" ADD CONSTRAINT "beo_areas_beo_id_beos_id_fk" FOREIGN KEY ("beo_id") REFERENCES "public"."beos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_areas" ADD CONSTRAINT "beo_areas_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_checklist_items" ADD CONSTRAINT "beo_checklist_items_beo_id_beos_id_fk" FOREIGN KEY ("beo_id") REFERENCES "public"."beos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_checklist_items" ADD CONSTRAINT "beo_checklist_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_run_of_show" ADD CONSTRAINT "beo_run_of_show_beo_id_beos_id_fk" FOREIGN KEY ("beo_id") REFERENCES "public"."beos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_run_of_show" ADD CONSTRAINT "beo_run_of_show_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beo_areas_beo_idx" ON "beo_areas" USING btree ("beo_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "beo_checklist_items_beo_idx" ON "beo_checklist_items" USING btree ("beo_id","sort_order");--> statement-breakpoint
CREATE INDEX "beo_run_of_show_beo_idx" ON "beo_run_of_show" USING btree ("beo_id","sort_order");--> statement-breakpoint
ALTER TABLE "beos" ADD CONSTRAINT "beos_run_of_show_mode_check" CHECK ("beos"."run_of_show_mode" in ('auto', 'on', 'off'));