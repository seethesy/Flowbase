CREATE TABLE "closeout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"closeout_id" uuid NOT NULL,
	"pull_line_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"pulled" numeric(14, 4) DEFAULT 0 NOT NULL,
	"returned" numeric(14, 4) DEFAULT 0 NOT NULL,
	"damaged" numeric(14, 4) DEFAULT 0 NOT NULL,
	"missing" numeric(14, 4) DEFAULT 0 NOT NULL,
	"used" numeric(14, 4) DEFAULT 0 NOT NULL,
	"leftover" numeric(14, 4) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closeout_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_closeouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sub_rentals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "event_closeouts_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "event_closeouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closeout_lines" ADD CONSTRAINT "closeout_lines_closeout_id_event_closeouts_id_fk" FOREIGN KEY ("closeout_id") REFERENCES "public"."event_closeouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_lines" ADD CONSTRAINT "closeout_lines_pull_line_id_pull_list_lines_id_fk" FOREIGN KEY ("pull_line_id") REFERENCES "public"."pull_list_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_lines" ADD CONSTRAINT "closeout_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_closeouts" ADD CONSTRAINT "event_closeouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "closeout_lines_closeout_line_idx" ON "closeout_lines" USING btree ("closeout_id","pull_line_id");