CREATE TABLE "staff_pay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"staff_full_name" text NOT NULL,
	"pay_type" text,
	"rate_cents" integer,
	"rate_unit" text,
	"second_rate_cents" integer,
	"second_rate_label" text DEFAULT '' NOT NULL,
	CONSTRAINT "staff_pay_pay_type_check" CHECK ("staff_pay"."pay_type" in ('hourly', 'per_event', 'salary')),
	CONSTRAINT "staff_pay_rate_unit_check" CHECK ("staff_pay"."rate_unit" in ('hour', 'event', 'year'))
);
--> statement-breakpoint
ALTER TABLE "staff_pay" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_pay_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"staff_full_name" text NOT NULL,
	"event_id" uuid,
	"project" text,
	"amount_cents" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "staff_pay_exceptions_target_check" CHECK (("staff_pay_exceptions"."event_id" is null) <> ("staff_pay_exceptions"."project" is null))
);
--> statement-breakpoint
ALTER TABLE "staff_pay_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletions" DROP CONSTRAINT "deletions_entity_type_check";--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_account" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_pay_name_idx" ON "staff_pay" USING btree (lower("staff_full_name")) WHERE "staff_pay"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_pay_exceptions_name_idx" ON "staff_pay_exceptions" USING btree (lower("staff_full_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email")) WHERE "users"."email" <> '';--> statement-breakpoint
ALTER TABLE "deletions" ADD CONSTRAINT "deletions_entity_type_check" CHECK ("deletions"."entity_type" in ('lead', 'client', 'venue', 'event', 'vendor', 'inventory_item', 'recipe', 'staff_member', 'sop'));--> statement-breakpoint
-- Staff pay (FLOW-270 A1): Technical reads and edits pay by default, like Admin.
-- Rows seeded at the old default (None) move to Write; an Admin can lower it again.
UPDATE "role_permissions" SET "level" = 'write', "updated_at" = now()
	WHERE "role" = 'technical' AND "area" = 'staff_pay' AND "level" = 'none' AND "archived_at" IS NULL;
