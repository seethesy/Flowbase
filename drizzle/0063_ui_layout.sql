CREATE TABLE "ui_layout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"page_key" text NOT NULL,
	"layout" jsonb NOT NULL,
	CONSTRAINT "ui_layout_page_key_unique" UNIQUE("page_key")
);
--> statement-breakpoint
ALTER TABLE "ui_layout" ENABLE ROW LEVEL SECURITY;