DELETE FROM "sms_outbox" WHERE "notification_id" IN (SELECT "id" FROM "notifications" WHERE "type" = 'event_day_change');--> statement-breakpoint
DELETE FROM "notification_preferences" WHERE "type" = 'event_day_change';--> statement-breakpoint
DELETE FROM "notifications" WHERE "type" = 'event_day_change';--> statement-breakpoint
DELETE FROM "role_permissions" WHERE "area" = 'day_of';--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{urgentNotificationTypes}', COALESCE((SELECT jsonb_agg(item.value) FROM jsonb_array_elements_text("value"->'urgentNotificationTypes') AS item(value) WHERE item.value <> 'event_day_change'), '[]'::jsonb)) WHERE "key" = 'defaults' AND jsonb_typeof("value"->'urgentNotificationTypes') = 'array';--> statement-breakpoint
DROP TABLE "day_of_checkpoints" CASCADE;--> statement-breakpoint
DROP TABLE "day_of_staff_states" CASCADE;--> statement-breakpoint
DROP TABLE "day_of_updates" CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_area_check";--> statement-breakpoint
ALTER TABLE "trucks" DROP COLUMN "location";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('account_email_changed', 'task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('account_email_changed', 'task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_area_check" CHECK ("role_permissions"."area" in ('leads', 'clients', 'proposals', 'events', 'beos', 'production', 'tasks', 'staff_directory', 'staff_pay', 'inventory_bar', 'purchasing', 'vendors', 'recipes_menus', 'documents', 'marketing_photos', 'reports', 'settings_users', 'live_editing'));
