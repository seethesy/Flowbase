CREATE TABLE "event_planning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid,
	CONSTRAINT "event_planning_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "event_planning" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_planning_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "event_planning_steps_step_check" CHECK ("event_planning_steps"."step" in ('holds', 'pull_list', 'requirements', 'production_tasks', 'kitchen_menu', 'beo_draft', 'calendar')),
	CONSTRAINT "event_planning_steps_status_check" CHECK ("event_planning_steps"."status" in ('pending', 'running', 'done', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "event_planning_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kitchen_menu_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"menu_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"course" text NOT NULL,
	"planned_quantity" numeric(14, 4),
	"notes" text DEFAULT '' NOT NULL,
	"source_key" text,
	"edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kitchen_menu_lines_quantity_check" CHECK ("kitchen_menu_lines"."planned_quantity" is null or "kitchen_menu_lines"."planned_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "kitchen_menu_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kitchen_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"leaves_kitchen_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	CONSTRAINT "kitchen_menus_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "kitchen_menus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pull_list_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"pull_list_id" uuid NOT NULL,
	"line_group" text NOT NULL,
	"item_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"section_id" uuid,
	"quantity" numeric(14, 4),
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'to_pull' NOT NULL,
	"setup_day" boolean DEFAULT false NOT NULL,
	"source_key" text,
	"edited" boolean DEFAULT false NOT NULL,
	"status_by" uuid,
	"status_at" timestamp with time zone,
	CONSTRAINT "pull_list_lines_group_check" CHECK ("pull_list_lines"."line_group" in ('kitchen_equipment', 'decor', 'supplies')),
	CONSTRAINT "pull_list_lines_status_check" CHECK ("pull_list_lines"."status" in ('to_pull', 'pulled', 'loaded', 'returned')),
	CONSTRAINT "pull_list_lines_quantity_check" CHECK ("pull_list_lines"."quantity" is null or "pull_list_lines"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pull_list_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pull_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"puller_id" uuid,
	"generated_at" timestamp with time zone,
	CONSTRAINT "pull_lists_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "pull_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_planning" ADD CONSTRAINT "event_planning_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_planning_steps" ADD CONSTRAINT "event_planning_steps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_menu_lines" ADD CONSTRAINT "kitchen_menu_lines_menu_id_kitchen_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."kitchen_menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_menu_lines" ADD CONSTRAINT "kitchen_menu_lines_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_menus" ADD CONSTRAINT "kitchen_menus_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_pull_list_id_pull_lists_id_fk" FOREIGN KEY ("pull_list_id") REFERENCES "public"."pull_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_list_lines" ADD CONSTRAINT "pull_list_lines_section_id_inventory_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inventory_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_lists" ADD CONSTRAINT "pull_lists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_lists" ADD CONSTRAINT "pull_lists_puller_id_users_id_fk" FOREIGN KEY ("puller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_planning_steps_event_step_idx" ON "event_planning_steps" USING btree ("event_id","step");--> statement-breakpoint
CREATE INDEX "kitchen_menu_lines_menu_idx" ON "kitchen_menu_lines" USING btree ("menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_menu_lines_source_idx" ON "kitchen_menu_lines" USING btree ("menu_id","source_key") WHERE "kitchen_menu_lines"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "pull_list_lines_list_idx" ON "pull_list_lines" USING btree ("pull_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_list_lines_source_idx" ON "pull_list_lines" USING btree ("pull_list_id","source_key") WHERE "pull_list_lines"."source_key" is not null;