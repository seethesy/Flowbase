CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"value" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_metric_period_idx" ON "usage_counters" USING btree ("metric","period");