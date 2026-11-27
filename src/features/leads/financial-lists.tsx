import { useState } from "react";
import { Link } from "react-router-dom";
import { T } from "../../app/copy";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useResource } from "../../app/useResource";
import { ErrorText, LoadingSkeleton, PageHeader } from "../../components/shared";
import { attachmentsApi } from "../../services/attachments";
import { leadsFinancialsApi } from "../../services/leads-financials";
import { formatCents, scheduleKindLabels } from "../../../shared/payments";

const date = (value: string) => value.slice(0, 10);

export function ContractsPage() {
  const contracts = useResource(["contracts", "all"], leadsFinancialsApi.contracts);
  const [fileError, setFileError] = useState("");
  const openFile = async (eventId: string, attachmentId: string) => {
    const tab = window.open("", "_blank");
    try {
      const file = (await attachmentsApi.list("event", eventId)).find((item) => item.id === attachmentId);
      if (!file?.urls.original) throw new Error("Contract file is unavailable.");
      if (tab) { tab.opener = null; tab.location.href = file.urls.original; }
      else window.open(file.urls.original, "_blank", "noopener,noreferrer");
    } catch (error) { tab?.close(); setFileError((error as Error).message); }
  };
  return <>
    <PageHeader pageKey="leads.contracts" title={<T id="leads.contracts.title">Contracts</T>} />
    <PageGrid pageKey="leads.contracts"><Block id="list" name="Contracts" h={20}>
      <ErrorText message={contracts.error ?? fileError} />
      {!contracts.data ? <LoadingSkeleton /> : <div className="table-card"><div className="table-scroll"><table>
        <thead><tr><th><T id="leads.contracts.event">Event</T></th><th><T id="leads.contracts.client">Client</T></th>
          <th><T id="leads.contracts.signed">Signed</T></th><th><T id="leads.contracts.file">Contract file</T></th>
          <th><T id="leads.contracts.addendums">Open addendums</T></th></tr></thead>
        <tbody>{contracts.data.map((row) => <tr key={row.id}>
          <td><Link to={`/events/${row.eventId}`}>{row.eventTitle}</Link></td><td>{row.clientName ?? "—"}</td>
          <td>{date(row.signedAt)}</td><td>{row.attachmentId ? <button type="button" onClick={() => void openFile(row.eventId, row.attachmentId!)}><T id="leads.contracts.open-file">Open file</T></button> : "—"}</td>
          <td><Link to={`/events/${row.eventId}`}>{row.openAddendums}</Link></td>
        </tr>)}</tbody>
      </table></div></div>}
    </Block></PageGrid>
  </>;
}

export function PaymentPage() {
  const payments = useResource(["payments", "all"], leadsFinancialsApi.payments);
  return <>
    <PageHeader pageKey="leads.payment" title={<T id="leads.payment.title">Payment</T>} />
    <PageGrid pageKey="leads.payment"><Block id="list" name="Payment" h={20}>
      {payments.error ? <ErrorText message={payments.error} /> : !payments.data ? <LoadingSkeleton /> :
        <div className="table-card"><div className="table-scroll"><table>
          <thead><tr><th><T id="leads.payment.event">Event</T></th><th><T id="leads.payment.client">Client</T></th>
            <th><T id="leads.payment.kind">Kind</T></th><th><T id="leads.payment.date">Due / received</T></th>
            <th><T id="leads.payment.amount">Amount</T></th><th><T id="leads.payment.paid">Paid</T></th>
            <th><T id="leads.payment.balance">Balance</T></th></tr></thead>
          <tbody>{payments.data.map((row) => <tr key={`${row.type}:${row.id}`}>
            <td><Link to={`/events/${row.eventId}?tab=payments`}>{row.eventTitle}</Link></td><td>{row.clientName ?? "—"}</td>
            <td>{row.kind ? scheduleKindLabels[row.kind] : <T id="leads.payment.received">Received</T>}</td>
            <td>{row.dueDate ?? "—"}</td><td>{formatCents(row.amountCents)}</td>
            <td>{formatCents(row.paidCents)}</td><td>{formatCents(row.balanceCents)}</td>
          </tr>)}</tbody>
        </table></div></div>}
    </Block></PageGrid>
  </>;
}
