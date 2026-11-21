CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"role" text NOT NULL,
	"area" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "role_permissions_role_check" CHECK ("role_permissions"."role" in ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff', 'part_time_staff')),
	CONSTRAINT "role_permissions_area_check" CHECK ("role_permissions"."area" in ('leads', 'clients', 'proposals', 'events', 'beos', 'production', 'day_of', 'tasks', 'staff_directory', 'staff_pay', 'inventory_bar', 'purchasing', 'vendors', 'recipes_menus', 'documents', 'marketing_photos', 'reports', 'settings_users', 'live_editing')),
	CONSTRAINT "role_permissions_level_check" CHECK ("role_permissions"."level" in ('none', 'read', 'own', 'write'))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_area_idx" ON "role_permissions" USING btree ("role","area");