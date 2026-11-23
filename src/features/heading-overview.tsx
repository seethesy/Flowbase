import { PageGrid } from "../app/page-grid";
import { usePermissions } from "../app/permissions";
import { T } from "../app/copy";
import { EmptyState, PageHeader } from "../components/shared";

// The Overview tab that opens the Sales, Marketing, Documents and Reports
// headings (FLOW-295). Each starts as an empty page layout (FLOW-273): an Admin
// in live edit adds cards, tables and text boxes, which everyone then sees.
// Until something is added, the page shows a short empty state.

function NothingYet() {
  const { can } = usePermissions();
  return (
    <section className="panel">
      <EmptyState
        title={<T id="heading-overview.empty.title">Nothing here yet</T>}
        description={can("layout.edit")
          ? <T id="heading-overview.empty.admin">Turn on Edit screen text to add cards, tables and text to this page.</T>
          : <T id="heading-overview.empty.description">Cards added to this page will show here.</T>}
      />
    </section>
  );
}

export function SalesOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.sales.title">Sales overview</T>} eyebrow={<T id="heading-overview.sales.eyebrow">Sales</T>} />
      <PageGrid pageKey="sales.overview"><NothingYet /></PageGrid>
    </>
  );
}

export function MarketingOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.marketing.title">Marketing overview</T>} eyebrow={<T id="heading-overview.marketing.eyebrow">Marketing</T>} />
      <PageGrid pageKey="marketing.overview"><NothingYet /></PageGrid>
    </>
  );
}

export function DocumentsOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.documents.title">Documents overview</T>} eyebrow={<T id="heading-overview.documents.eyebrow">Documents</T>} />
      <PageGrid pageKey="documents.overview"><NothingYet /></PageGrid>
    </>
  );
}

export function ReportsOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.reports.title">Reports overview</T>} eyebrow={<T id="heading-overview.reports.eyebrow">Reports</T>} />
      <PageGrid pageKey="reports.overview"><NothingYet /></PageGrid>
    </>
  );
}
