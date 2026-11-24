import { useState } from "react";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Link } from "react-router-dom";
import { allPages } from "../../services/core";
import { approvalsApi } from "../../services/approvals";
import { useResource } from "../../app/useResource";
import { Button, LoadingSkeleton, PageHeader, ErrorText } from "../../components/shared";
import { T, useCopy } from "../../app/copy";

export function ApprovalQueue() {
  const reasonForRejectionPlaceholder = useCopy("approval-queue.approval-queue.reason-for-rejection.placeholder", "Reason for rejection");
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
    <PageHeader pageKey="approvals.queue" title={<T id="approval-queue.approval-queue.approvals">Approvals</T>} subtitle={<T id="approval-queue.approval-queue.requests-waiting-for-your-decision">Requests waiting for your decision.</T>} eyebrow={<T id="approval-queue.approval-queue.workflow">WORKFLOW</T>} />
    <ErrorText message={error} />
    <PageGrid pageKey="approvals.queue">
    <Block id="queue" name="Requests" h={24}>
    {queue.error ? <ErrorText message={queue.error} /> : queue.loading && !queue.data ? <LoadingSkeleton /> :
      <div className="approval-queue">{queue.data?.map((approval) => <section key={approval.id} className="table-card" style={{ padding: 16, marginBottom: 12 }}>
        <h2>{approval.summary}</h2>
        <p>{approval.requester?.name ?? <T id="approval-queue.approval-queue.unknown-proposer">Unknown proposer</T>} · {new Date(approval.createdAt).toLocaleString()}</p>
        {approval.link && <Link to={approval.link}><T id="approval-queue.approval-queue.view-record">View record</T></Link>}
        {approval.canDecide && <div className="form-actions">
          <Button onClick={() => void decide(approval.id, "approve")}><T id="approval-queue.approval-queue.approve">Approve</T></Button>
          <input aria-label={`Rejection reason for ${approval.summary}`} placeholder={reasonForRejectionPlaceholder} data-copy-id="approval-queue.approval-queue.reason-for-rejection.placeholder"
            value={reason[approval.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [approval.id]: event.target.value }))} />
          <Button variant="outline" onClick={() => void decide(approval.id, "reject")}><T id="approval-queue.approval-queue.reject">Reject</T></Button>
        </div>}
      </section>)}</div>}
    </Block>
    </PageGrid>
  </>;
}
