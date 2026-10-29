import { useState } from "react";
import { Link } from "react-router-dom";
import { allPages } from "../services/core";
import { approvalsApi } from "../services/approvals";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, PageHeader } from "../components/shared";
import { LoadError } from "../components/record-display";

export function ApprovalQueue() {
  const queue = useResource(["approval-queue"], () => allPages(approvalsApi.list));
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const decide = async (id: string, decision: "approve" | "reject") => {
    setError("");
    try {
      if (decision === "approve") await approvalsApi.approve(id);
      else await approvalsApi.reject(id, reason[id] ?? "");
      queue.reload();
    } catch (cause) { setError((cause as Error).message); }
  };
  return <>
    <PageHeader title="Approvals" subtitle="Requests waiting for your decision." eyebrow="WORKFLOW" />
    {error && <p role="alert" className="error-message">{error}</p>}
    {queue.error ? <LoadError message={queue.error} /> : queue.loading && !queue.data ? <LoadingSkeleton /> :
      <div className="approval-queue">{queue.data?.map((approval) => <section key={approval.id} className="table-card" style={{ padding: 16, marginBottom: 12 }}>
        <h2>{approval.summary}</h2>
        <p>{approval.requester?.name ?? "Unknown proposer"} · {new Date(approval.createdAt).toLocaleString()}</p>
        {approval.link && <Link to={approval.link}>View record</Link>}
        {approval.canDecide && <div className="form-actions">
          <Button onClick={() => void decide(approval.id, "approve")}>Approve</Button>
          <input aria-label={`Rejection reason for ${approval.summary}`} placeholder="Reason for rejection"
            value={reason[approval.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [approval.id]: event.target.value }))} />
          <Button variant="outline" onClick={() => void decide(approval.id, "reject")}>Reject</Button>
        </div>}
      </section>)}</div>}
  </>;
}
