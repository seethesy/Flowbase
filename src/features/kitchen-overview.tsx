import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { KitchenOverviewRow } from "../../shared/kitchen-overview";
import { Block, PageGrid } from "../app/page-grid";
import { T } from "../app/copy";
import { useResource } from "../app/useResource";
import { LoadError } from "../components/record-display";
import { DataTable, DateTimeCell, LoadingSkeleton } from "../components/shared";
import { kitchenApi } from "../services/kitchen";
import { calendarWhenParts } from "./calendar-entries";
import { KitchenHeading } from "./kitchen-screen";

// Kitchen › Overview (FLOW-293): every menu item of the events in the next 14
// days, one row per kitchen line, so the kitchen sees what to make, when, for how
// many and who is making it. In charge is a dropdown of kitchen staff for anyone
// who may edit the kitchen menu; changing it never opens the row (FLOW-296). A
// row opens its event, where the kitchen menu is.
export function KitchenOverviewPage() {
  const navigate = useNavigate();
  const overview = useResource(["kitchen-overview"], kitchenApi.overview);
  const data = overview.data;
  const names = new Map((data?.staff ?? []).map((person) => [person.id, person.name]));

  const columns: ColumnDef<KitchenOverviewRow, unknown>[] = [
    {
      id: "ready",
      header: "Date / Food ready time",
      accessorFn: (row) => `${row.date}T${row.foodReadyTime}`,
      cell: ({ row }) => {
        const parts = calendarWhenParts({ start: `${row.original.date}T${row.original.foodReadyTime}` });
        return <DateTimeCell date={parts.date} time={parts.time} />;
      },
    },
    { id: "event", header: "Event", accessorFn: (row) => row.eventTitle },
    { id: "guests", header: "Guest count", accessorFn: (row) => row.guestCount ?? "—" },
    {
      id: "item",
      header: "Menu item",
      accessorFn: (row) => row.menuItem,
      cell: ({ row }) => (
        <span className="kitchen-overview-item">
          {row.original.menuItem}
          {row.original.course && <small className="muted">{row.original.course}</small>}
        </span>
      ),
      meta: { csv: (row) => `${row.menuItem} (${row.course})` },
    },
    { id: "serving", header: "Serving size", accessorFn: (row) => row.servingSize ?? "" },
    { id: "requests", header: "Special requests", accessorFn: (row) => row.specialRequests },
    { id: "allergies", header: "Allergies", accessorFn: (row) => row.allergies.join(", ") },
    {
      id: "inCharge",
      header: "In charge",
      accessorFn: (row) => (row.inChargeStaffId ? names.get(row.inChargeStaffId) ?? "" : ""),
      meta: {
        edit: "select",
        canEdit: () => Boolean(data?.canEdit),
        editValue: (row) => row.inChargeStaffId ?? "",
        editOptions: [{ value: "", label: "Unassigned" }, ...(data?.staff ?? []).map((person) => ({ value: person.id, label: person.name }))],
        onEdit: async (row, value) => {
          await kitchenApi.setInCharge(row.lineId, { staffId: value || null });
          overview.reload();
        },
      },
    },
  ];

  return (
    <>
      <KitchenHeading tab="overview" />
      <PageGrid pageKey="kitchen.overview">
        <Block id="menu-items" name="Menu items" h={24}>
          {overview.error && <LoadError message={overview.error} />}
          {!data && !overview.error && <LoadingSkeleton />}
          {data && !data.rows.length && (
            <p className="muted"><T id="kitchen-overview.table.no-menu-items">No menu items for events in the next 14 days.</T></p>
          )}
          {data && data.rows.length > 0 && (
            <DataTable
              copyKey="kitchen-overview.table"
              openColumn
              data={data.rows}
              columns={columns}
              onRow={(row) => navigate(`/events/${row.eventId}`)}
              label={<T id="kitchen-overview.table.menu-items">Menu items</T>}
              exportName="kitchen-overview"
            />
          )}
        </Block>
      </PageGrid>
    </>
  );
}
