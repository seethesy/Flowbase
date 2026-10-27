CREATE TABLE "import_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"module" text NOT NULL,
	"external_key" text NOT NULL,
	"record_id" uuid NOT NULL,
	"import_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"module" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_logs_status_check" CHECK ("import_logs"."status" in ('running', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "import_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_keys" ADD CONSTRAINT "import_keys_import_id_import_logs_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_keys_module_key_idx" ON "import_keys" USING btree ("module","external_key");--> statement-breakpoint
CREATE INDEX "import_logs_module_idx" ON "import_logs" USING btree ("module","created_at");