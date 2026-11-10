CREATE TABLE "event_planning_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cause" text NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stale_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_planning_outputs_kind_check" CHECK ("event_planning_outputs"."kind" in ('pull_list', 'requirements', 'order_list', 'kitchen_menu', 'beo', 'truck_log'))
);
--> statement-breakpoint
ALTER TABLE "event_planning_outputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "truck_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"truck_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"departs_at" timestamp with time zone NOT NULL,
	"returns_at" timestamp with time zone NOT NULL,
	"driver_id" uuid,
	"loader_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"load_task_id" uuid,
	"conflict_acknowledged_at" timestamp with time zone,
	"conflict_message" text,
	CONSTRAINT "truck_assignments_window_check" CHECK ("truck_assignments"."returns_at" > "truck_assignments"."departs_at")
);
--> statement-breakpoint
ALTER TABLE "truck_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	CONSTRAINT "trucks_name_unique" UNIQUE("name"),
	CONSTRAINT "trucks_status_check" CHECK ("trucks"."status" in ('available', 'loading', 'en_route', 'at_event', 'returning', 'maintenance'))
);
--> statement-breakpoint
ALTER TABLE "trucks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "trucks" ("name") VALUES ('Truck A'), ('Truck B'), ('Truck C');--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD COLUMN "truck_id" uuid;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "match_catalog_id" uuid;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "match_line_kind" text;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "match_event_type" text;--> statement-breakpoint
ALTER TABLE "event_planning_outputs" ADD CONSTRAINT "event_planning_outputs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_assignments" ADD CONSTRAINT "truck_assignments_load_task_id_tasks_id_fk" FOREIGN KEY ("load_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_planning_outputs_event_kind_idx" ON "event_planning_outputs" USING btree ("event_id","kind");--> statement-breakpoint
CREATE INDEX "truck_assignments_truck_window_idx" ON "truck_assignments" USING btree ("truck_id","departs_at","returns_at");--> statement-breakpoint
CREATE INDEX "truck_assignments_event_idx" ON "truck_assignments" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_match_line_kind_check" CHECK ("task_templates"."match_line_kind" in ('menu', 'rental', 'decor', 'service', 'supply'));
