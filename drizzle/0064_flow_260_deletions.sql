CREATE TABLE "deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" uuid,
	"restored_at" timestamp with time zone,
	"restored_by" uuid,
	CONSTRAINT "deletions_entity_type_check" CHECK ("deletions"."entity_type" in ('lead', 'client', 'venue', 'event', 'vendor', 'inventory_item', 'recipe'))
);
--> statement-breakpoint
ALTER TABLE "deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deletions_entity_idx" ON "deletions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "deletions_open_idx" ON "deletions" USING btree ("deleted_at") WHERE "deletions"."restored_at" is null;