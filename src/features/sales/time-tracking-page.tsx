import { PageHeader } from "../../components/shared";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { T } from "../../app/copy";
import { TimeReports } from "../staff/time-tracking";
import { OperationalReports } from "../home/operational-reports";

export function SalesTimeTrackingPage() {
  const { can } = usePermissions();
  return <>
    <PageHeader pageKey="sales.time-tracking" title={<T id="sales.time-tracking.title">Time Tracking</T>} />
    <PageGrid pageKey="sales.time-tracking">
      {can("time.read") && <Block id="time" name="Time reports" h={20}><TimeReports embedded /></Block>}
      {can("reports.operations.read") && <Block id="operations" name="Operational reports" h={20}><OperationalReports embedded /></Block>}
    </PageGrid>
  </>;
}
