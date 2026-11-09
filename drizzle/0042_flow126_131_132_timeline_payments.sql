CREATE TABLE "event_timeline_entries" (
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
	"activity" text NOT NULL,
	"who_type" text,
	"who_user_id" uuid,
	"who_role" text,
	"who_vendor_id" uuid,
	"area_name" text DEFAULT '' NOT NULL,
	"proposal_id" uuid,
	"source_key" text,
	CONSTRAINT "event_timeline_entries_kind_check" CHECK ("event_timeline_entries"."kind" in ('production', 'event')),
	CONSTRAINT "event_timeline_entries_who_type_check" CHECK ("event_timeline_entries"."who_type" in ('staff', 'role', 'vendor')),
	CONSTRAINT "event_timeline_entries_ends_after_start" CHECK ("event_timeline_entries"."ends_at" > "event_timeline_entries"."starts_at"),
	CONSTRAINT "event_timeline_entries_who_check" CHECK (("event_timeline_entries"."who_type" is null and "event_timeline_entries"."who_user_id" is null and "event_timeline_entries"."who_role" is null and "event_timeline_entries"."who_vendor_id" is null)
        or ("event_timeline_entries"."who_type" = 'staff' and "event_timeline_entries"."who_user_id" is not null and "event_timeline_entries"."who_role" is null and "event_timeline_entries"."who_vendor_id" is null)
        or ("event_timeline_entries"."who_type" = 'role' and "event_timeline_entries"."who_role" is not null and "event_timeline_entries"."who_user_id" is null and "event_timeline_entries"."who_vendor_id" is null)
        or ("event_timeline_entries"."who_type" = 'vendor' and "event_timeline_entries"."who_vendor_id" is not null and "event_timeline_entries"."who_user_id" is null and "event_timeline_entries"."who_role" is null))
);
--> statement-breakpoint
ALTER TABLE "event_timeline_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"proposal_id" uuid,
	"source_key" text,
	CONSTRAINT "payment_schedule_items_kind_check" CHECK ("payment_schedule_items"."kind" in ('deposit', 'installment', 'balance')),
	CONSTRAINT "payment_schedule_items_amount_positive" CHECK ("payment_schedule_items"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_on" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('card', 'zelle', 'ach', 'wire', 'check', 'cash')),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_timeline_entries" ADD CONSTRAINT "event_timeline_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_timeline_entries" ADD CONSTRAINT "event_timeline_entries_who_user_id_users_id_fk" FOREIGN KEY ("who_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_timeline_entries" ADD CONSTRAINT "event_timeline_entries_who_vendor_id_vendors_id_fk" FOREIGN KEY ("who_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_timeline_entries" ADD CONSTRAINT "event_timeline_entries_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_timeline_entries_event_idx" ON "event_timeline_entries" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_timeline_entries_source_idx" ON "event_timeline_entries" USING btree ("proposal_id","source_key") WHERE "event_timeline_entries"."source_key" is not null and "event_timeline_entries"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payment_schedule_items_event_idx" ON "payment_schedule_items" USING btree ("event_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_schedule_items_source_idx" ON "payment_schedule_items" USING btree ("proposal_id","source_key") WHERE "payment_schedule_items"."source_key" is not null and "payment_schedule_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payments_event_idx" ON "payments" USING btree ("event_id","received_on");