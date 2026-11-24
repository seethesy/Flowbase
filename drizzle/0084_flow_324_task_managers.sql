CREATE TABLE "task_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_managers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "tasks_overseer_idx";--> statement-breakpoint
ALTER TABLE "task_managers" ADD CONSTRAINT "task_managers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_managers_task_user_idx" ON "task_managers" USING btree ("task_id","user_id") WHERE "task_managers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "task_managers_user_idx" ON "task_managers" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "task_managers" ("task_id", "user_id", "created_by", "updated_by")
SELECT "id", "overseer_id", "created_by", "updated_by" FROM "tasks" WHERE "overseer_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "overseer_id";
