ALTER TABLE "attachments" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "doc_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "version_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_document_idx" ON "attachments" USING btree ("document_id","version_number");
--> statement-breakpoint
UPDATE "attachments" SET "document_id" = "id", "display_name" = "file_name",
  "doc_type" = CASE
    WHEN "record_type" = 'sop' THEN 'sop'
    WHEN "group" = 'menu' THEN 'menu'
    WHEN "group" = 'contract' THEN 'contract'
    WHEN "group" = 'invoice' THEN 'invoice'
    WHEN "variants" @> '[{"name":"thumb"}]'::jsonb THEN 'photo'
    ELSE 'other' END;
--> statement-breakpoint
INSERT INTO "attachments" ("record_type", "record_id", "group", "file_name", "document_id", "display_name", "doc_type", "version_number", "status", "variants", "created_at", "updated_at", "created_by", "updated_by")
SELECT 'event', p."event_id", 'generated', v."docx"->>'fileName', p."id", p."title", 'proposal', v."number", 'ready',
  jsonb_build_array(jsonb_build_object('name', 'original', 'key', v."docx"->>'key', 'contentType', v."docx"->>'contentType', 'size', (v."docx"->>'size')::int)),
  v."created_at", v."updated_at", v."created_by", v."updated_by"
FROM "proposal_versions" v JOIN "proposals" p ON p."id" = v."proposal_id"
WHERE v."status" = 'ready' AND p."archived_at" IS NULL;
