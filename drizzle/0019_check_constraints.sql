ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_record_type_check" CHECK ("activity_sessions"."record_type" in ('lead', 'client', 'proposal', 'event', 'beo', 'task'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_status_check" CHECK ("attachments"."status" in ('pending', 'ready'));--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" in ('create', 'update', 'archive', 'restore'));--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_role_check" CHECK ("client_contacts"."role" in ('primary_poc', 'billing', 'venue_manager', 'event_coordinator'));--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_kind_check" CHECK ("clients"."kind" in ('person', 'organization'));--> statement-breakpoint
ALTER TABLE "collector_runs" ADD CONSTRAINT "collector_runs_status_check" CHECK ("collector_runs"."status" in ('ok', 'needs_login', 'blocked', 'error'));--> statement-breakpoint
ALTER TABLE "event_status_history" ADD CONSTRAINT "event_status_history_from_status_check" CHECK ("event_status_history"."from_status" in ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));--> statement-breakpoint
ALTER TABLE "event_status_history" ADD CONSTRAINT "event_status_history_to_status_check" CHECK ("event_status_history"."to_status" in ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_check" CHECK ("events"."status" in ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));--> statement-breakpoint
ALTER TABLE "inventory_bar_details" ADD CONSTRAINT "inventory_bar_details_container_check" CHECK ("inventory_bar_details"."container" in ('bottle', 'can', 'keg'));--> statement-breakpoint
ALTER TABLE "inventory_cost_history" ADD CONSTRAINT "inventory_cost_history_source_check" CHECK ("inventory_cost_history"."source" in ('manual', 'receiving'));--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_kind_check" CHECK ("inventory_items"."kind" in ('rental', 'consumable', 'service'));--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_ratio_basis_check" CHECK ("inventory_items"."ratio_basis" in ('per_guest', 'per_table', 'per_event'));--> statement-breakpoint
ALTER TABLE "inventory_sections" ADD CONSTRAINT "inventory_sections_kind_check" CHECK ("inventory_sections"."kind" in ('rental', 'consumable'));--> statement-breakpoint
ALTER TABLE "inventory_service_details" ADD CONSTRAINT "inventory_service_details_price_basis_check" CHECK ("inventory_service_details"."price_basis" in ('per_guest', 'per_table', 'per_event'));--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_quantity_check" CHECK ("inventory_stock"."quantity" >= 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'running', 'succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "lead_duplicates" ADD CONSTRAINT "lead_duplicates_reason_check" CHECK ("lead_duplicates"."reason" in ('email', 'phone', 'name_event_date'));--> statement-breakpoint
ALTER TABLE "lead_duplicates" ADD CONSTRAINT "lead_duplicates_status_check" CHECK ("lead_duplicates"."status" in ('open', 'merged', 'dismissed'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_channel_check" CHECK ("leads"."channel" in ('collector', 'webhook', 'manual', 'import'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'contacted', 'qualified', 'converted', 'lost'));--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_status_check" CHECK ("stock_counts"."status" in ('open', 'completed'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('receive', 'adjust', 'count', 'transfer', 'pull', 'return', 'damage_loss', 'consume'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_link_type_check" CHECK ("stock_movements"."link_type" in ('event', 'order', 'import'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employment_type_check" CHECK ("users"."employment_type" in ('full_time', 'part_time'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" in ('pending', 'active', 'deactivated', 'revoked'));--> statement-breakpoint
ALTER TABLE "venue_contacts" ADD CONSTRAINT "venue_contacts_role_check" CHECK ("venue_contacts"."role" in ('manager', 'coordinator'));--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_jurisdiction_check" CHECK ("venues"."jurisdiction" in ('DC', 'MD', 'VA'));