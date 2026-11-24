import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { mayGenerateBeoFrom } from "../../../shared/beo-from-proposal";
import type { ProposalStage } from "../../../shared/proposals";
import { proposalsApi } from "../../services/proposals";
import { ApiRequestError } from "../../services/core";
import { usePermissions } from "../../app/permissions";
import { Button, ErrorText } from "../../components/shared";
import { T } from "../../app/copy";

// Generate BEO on a proposal at Closing or Closed (FLOW-337), for people who can
// edit events. It lands on the event's BEO page. A proposal whose current version
// isn't reviewed yet goes to its review first (A1): onNeedsReview.
export function GenerateBeoButton({
  proposal,
  onNeedsReview,
}: {
  proposal: { id: string; eventId: string; stage: ProposalStage };
  onNeedsReview: () => void;
}) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!can("events.write") || !mayGenerateBeoFrom(proposal.stage)) return null;
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const beo = await proposalsApi.generateBeo(proposal.id);
      navigate(`/events/${proposal.eventId}/beo/${beo.id}`);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === "MAPPING_REQUIRED") onNeedsReview();
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => void generate()}>
        <T id="beo.generate-from-proposal.button">Generate BEO</T>
      </Button>
      <ErrorText message={error} />
    </>
  );
}
