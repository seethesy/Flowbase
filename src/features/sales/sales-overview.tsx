import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { T } from "../../app/copy";
import { PageHeader } from "../../components/shared";
import { salesHeadingStatuses } from "../../../shared/leads";
import { useLeadTable } from "../leads/lead-inbox";

// Sales › Overview (FLOW-328): the leads table limited to the late pipeline
// stages (Negotiation, Closing, Closed). It started as an empty page (FLOW-295),
// so cards an Admin placed around it stay. A role that opens this page through
// another Sales tab but can't read leads sees only those cards.
export function SalesOverview() {
  const { can } = usePermissions();
  return (
    <>
      <PageHeader title={<T id="heading-overview.sales.title">Sales overview</T>} eyebrow={<T id="heading-overview.sales.eyebrow">Sales</T>} />
      {can("leads.read") ? <SalesLeads /> : <PageGrid pageKey="sales.overview">{null}</PageGrid>}
    </>
  );
}

function SalesLeads() {
  const leads = useLeadTable({ statuses: salesHeadingStatuses });
  return (
    <>
      <PageGrid pageKey="sales.overview">
        <Block id="lead-table" name="Leads table" h={24}>{leads.table}</Block>
      </PageGrid>
      {leads.overlays}
    </>
  );
}
