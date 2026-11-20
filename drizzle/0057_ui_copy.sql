CREATE TABLE "ui_copy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"key" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "ui_copy_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "ui_copy" ENABLE ROW LEVEL SECURITY;