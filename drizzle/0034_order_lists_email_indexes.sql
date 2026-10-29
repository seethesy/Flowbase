CREATE TABLE "order_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_id" uuid,
	CONSTRAINT "order_lists_status_check" CHECK ("order_lists"."status" in ('draft', 'submitted', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "order_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_lists" ADD CONSTRAINT "order_lists_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lists_status_idx" ON "order_lists" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "client_contacts_email_lower_idx" ON "client_contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "leads_email_lower_idx" ON "leads" USING btree (lower("email"));