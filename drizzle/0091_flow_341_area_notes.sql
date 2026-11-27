CREATE TABLE "area_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"key" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	CONSTRAINT "area_notes_key_unique" UNIQUE("key"),
	CONSTRAINT "area_notes_key_check" CHECK ("area_notes"."key" in ('marketing.overview', 'marketing.socials', 'marketing.movies', 'marketing.other-events', 'marketing.seo'))
);
--> statement-breakpoint
ALTER TABLE "area_notes" ENABLE ROW LEVEL SECURITY;