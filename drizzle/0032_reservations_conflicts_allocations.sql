CREATE TABLE "consumable_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"required" numeric(14, 4) NOT NULL,
	"allocated" numeric(14, 4) NOT NULL,
	"shortage" numeric(14, 4) NOT NULL,
	"projected_stock" numeric(14, 4) NOT NULL,
	"order_by" date,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumable_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"basis" text DEFAULT 'fixed' NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "event_requirements_basis_check" CHECK ("event_requirements"."basis" in ('fixed', 'per_guest')),
	CONSTRAINT "event_requirements_quantity_check" CHECK ("event_requirements"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"reservation_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"allocated" numeric(14, 4) NOT NULL,
	"shortfall" numeric(14, 4) NOT NULL,
	"signature" text NOT NULL,
	"notified_signature" text,
	"resolution" jsonb,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reservation_conflicts_kind_check" CHECK ("reservation_conflicts"."kind" in ('conflict', 'warning')),
	CONSTRAINT "reservation_conflicts_state_check" CHECK ("reservation_conflicts"."state" in ('open', 'accepted', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "reservation_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'tentative' NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('tentative', 'confirmed', 'released')),
	CONSTRAINT "reservations_quantity_check" CHECK ("reservations"."quantity" > 0),
	CONSTRAINT "reservations_window_check" CHECK ("reservations"."window_end" >= "reservations"."window_start")
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_allocations" ADD CONSTRAINT "consumable_allocations_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requirements" ADD CONSTRAINT "event_requirements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requirements" ADD CONSTRAINT "event_requirements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_conflicts" ADD CONSTRAINT "reservation_conflicts_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_conflicts" ADD CONSTRAINT "reservation_conflicts_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_conflicts" ADD CONSTRAINT "reservation_conflicts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumable_allocations_event_item_idx" ON "consumable_allocations" USING btree ("event_id","item_id");--> statement-breakpoint
CREATE INDEX "consumable_allocations_item_idx" ON "consumable_allocations" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_requirements_line_idx" ON "event_requirements" USING btree ("event_id","item_id","source") WHERE "event_requirements"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "event_requirements_item_idx" ON "event_requirements" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_conflicts_live_idx" ON "reservation_conflicts" USING btree ("reservation_id") WHERE "reservation_conflicts"."state" <> 'resolved' and "reservation_conflicts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "reservation_conflicts_item_idx" ON "reservation_conflicts" USING btree ("item_id","state");--> statement-breakpoint
CREATE INDEX "reservation_conflicts_event_idx" ON "reservation_conflicts" USING btree ("event_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_event_item_idx" ON "reservations" USING btree ("event_id","item_id") WHERE "reservations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "reservations_item_window_idx" ON "reservations" USING btree ("item_id","window_start","window_end");