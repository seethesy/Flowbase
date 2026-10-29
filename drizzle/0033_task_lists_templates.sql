CREATE TABLE "task_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'production' NOT NULL,
	"offset_days" integer NOT NULL,
	"time" text,
	"position" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_template_items_type_check" CHECK ("task_template_items"."type" in ('general', 'delegated', 'kitchen', 'production', 'truck_load', 'misc'))
);
--> statement-breakpoint
ALTER TABLE "task_template_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"sop_url" text
);
--> statement-breakpoint
ALTER TABLE "task_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "template_item_id" uuid;--> statement-breakpoint
ALTER TABLE "task_template_items" ADD CONSTRAINT "task_template_items_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_template_items_template_idx" ON "task_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_templates_name_idx" ON "task_templates" USING btree (lower("name")) WHERE "task_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "task_views_user_idx" ON "task_views" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_event_template_item_idx" ON "tasks" USING btree ("event_id","template_item_id") WHERE "tasks"."template_item_id" is not null;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'payment_due', 'payment_overdue', 'collector_failure'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'payment_due', 'payment_overdue', 'collector_failure'));