ALTER TABLE "users" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "drives" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_car" boolean;