CREATE TABLE "sales_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "sales_views_user_idx" ON "sales_views" USING btree ("user_id","created_at");