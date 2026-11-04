CREATE TABLE "sop_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"sop_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sop_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "sop_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sop_id" uuid;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sop_versions_sop_version_idx" ON "sop_versions" USING btree ("sop_id","version");--> statement-breakpoint
CREATE INDEX "sops_category_title_idx" ON "sops" USING btree ("category","title");--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE no action ON UPDATE no action;