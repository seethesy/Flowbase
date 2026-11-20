-- Allow both key sets until the generated schema migration replaces these checks.
ALTER TABLE "events" DROP CONSTRAINT "events_status_check";
ALTER TABLE "events" ADD CONSTRAINT "events_status_check" CHECK ("status" IN ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));
ALTER TABLE "event_status_history" DROP CONSTRAINT "event_status_history_from_status_check";
ALTER TABLE "event_status_history" ADD CONSTRAINT "event_status_history_from_status_check" CHECK ("from_status" IN ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));
ALTER TABLE "event_status_history" DROP CONSTRAINT "event_status_history_to_status_check";
ALTER TABLE "event_status_history" ADD CONSTRAINT "event_status_history_to_status_check" CHECK ("to_status" IN ('inquiry', 'pitching', 'proposal_creation', 'initial_proposal_sent', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'preparation', 'finished', 'lost'));

UPDATE "events" SET "status" = CASE "status" WHEN 'proposal_creation' THEN 'p_creation' WHEN 'initial_proposal_sent' THEN 'p_sent' ELSE "status" END WHERE "status" IN ('proposal_creation', 'initial_proposal_sent');
UPDATE "event_status_history" SET "from_status" = CASE "from_status" WHEN 'proposal_creation' THEN 'p_creation' WHEN 'initial_proposal_sent' THEN 'p_sent' ELSE "from_status" END, "to_status" = CASE "to_status" WHEN 'proposal_creation' THEN 'p_creation' WHEN 'initial_proposal_sent' THEN 'p_sent' ELSE "to_status" END WHERE "from_status" IN ('proposal_creation', 'initial_proposal_sent') OR "to_status" IN ('proposal_creation', 'initial_proposal_sent');
