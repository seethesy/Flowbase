ALTER TABLE "proposals" DROP CONSTRAINT "proposals_stage_check";
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_stage_check" CHECK ("stage" IN ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));
ALTER TABLE "proposal_stage_history" DROP CONSTRAINT "proposal_stage_history_from_stage_check";
ALTER TABLE "proposal_stage_history" DROP CONSTRAINT "proposal_stage_history_to_stage_check";
ALTER TABLE "proposal_stage_history" ADD CONSTRAINT "proposal_stage_history_from_stage_check" CHECK ("from_stage" IN ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));
ALTER TABLE "proposal_stage_history" ADD CONSTRAINT "proposal_stage_history_to_stage_check" CHECK ("to_stage" IN ('client_communication', 'menu_curation', 'revisions', 'finalized', 'approved', 'sent', 'signed', 'inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));
UPDATE "proposals" SET "stage" = CASE "stage"
  WHEN 'client_communication' THEN 'p_creation'
  WHEN 'menu_curation' THEN 'p_creation'
  WHEN 'revisions' THEN 'p_creation'
  WHEN 'finalized' THEN 'p_creation'
  WHEN 'approved' THEN 'p_creation'
  WHEN 'sent' THEN 'p_sent'
  WHEN 'signed' THEN 'closed'
  ELSE "stage" END;
