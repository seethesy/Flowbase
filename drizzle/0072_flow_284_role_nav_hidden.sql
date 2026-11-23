CREATE TABLE "role_nav_hidden" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"role" text NOT NULL,
	"hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "role_nav_hidden_role_unique" UNIQUE("role"),
	CONSTRAINT "role_nav_hidden_role_check" CHECK ("role_nav_hidden"."role" in ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff', 'part_time_staff'))
);
--> statement-breakpoint
ALTER TABLE "role_nav_hidden" ENABLE ROW LEVEL SECURITY;