import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  beoListStatuses,
  beoListStatusLabels,
  beoListWhens,
  beoListWhenLabels,
  type BeoListRow,
  type BeoListStatus,
  type BeoListWhen,
} from "../../../shared/beo-list";
import { utcToBusinessTime } from "../../../shared/time";
import { useResource } from "../../app/useResource";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { LabelT, T } from "../../app/copy";
import { beoApi } from "../../services/beo";
import { Button, DataTable, DateTimeCell, DetailDrawer, FilterBar, LoadingSkeleton, ErrorText } from "../../components/shared";
import { Dropdown } from "../../components/ui/Dropdown";
import { useDeletable } from "../../app/live-edit/deletable";
import { calendarWhenParts, weekday } from "../events/calendar-entries";
import { EventsHeading } from "../events/events-heading";
import "./beo-list.css";

// The Events screen's BEOs tab (FLOW-265): every event's BEO the viewer may open,
// with its version, status (Final = approved on a Finished event, A1), owner,
// last editor and the approved PDF saved in Documents (FLOW-263). BEO content is
// edited on the BEO page. Open shows a side preview. Rows select for bulk Delete
// with Undo (FLOW-288); approved and Final BEOs are skipped with the reason.

const tone: Record<BeoListStatus, string> = {
  draft: "neutral",
  awaiting_approval: "warning",
  approved: "success",
  final: "info",
};
export function BeoStatusBadge({ status }: { status: BeoListStatus }) {
  return (
    <span className={`badge ${tone[status]}`}>
      <LabelT id="labels.beo-list-status" value={status}>{beoListStatusLabels[status]}</LabelT>
    </span>
  );
}

const day = (instant: string) => weekday(utcToBusinessTime(new Date(instant)).date);
// The event's day with its time beneath it (FLOW-296).
const eventDay = (row: BeoListRow) => {
  const { date, time } = utcToBusinessTime(new Date(row.eventStartsAt));
  const parts = calendarWhenParts({ start: `${date}T${time}` });
  return <DateTimeCell date={parts.date} time={parts.time} />;
};

export function BeoListPage() {
  const navigate = useNavigate();
  const [when, setWhen] = useState<BeoListWhen>("upcoming");
  const [status, setStatus] = useState<BeoListStatus | "">("");
  const [owner, setOwner] = useState("");
  const beos = useResource(["beos", when, status, owner], () =>
    beoApi.list({ when, status: status || undefined, owner: owner || undefined }),
  );
  // Owner choices: the owners of the BEOs in view, and the chosen one.
  const ownerList = useResource(["beos", when, "owners"], () => beoApi.list({ when }));
  const owners = [
    ...new Map(
      (ownerList.data ?? []).flatMap((row) => (row.owner ? [[row.owner.id, row.owner.name] as const] : [])),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const [selected, setSelected] = useState<BeoListRow | null>(null);
  const deletable = useDeletable("beo", () => {
    beos.reload();
    ownerList.reload();
  });

  const columns: ColumnDef<BeoListRow, unknown>[] = [
    { id: "event", header: "Event", accessorFn: (row) => row.eventTitle },
    { id: "date", header: "Event date", accessorFn: (row) => row.eventStartsAt, cell: ({ row }) => eventDay(row.original) },
    {
      id: "version",
      header: "BEO version",
      accessorFn: (row) => row.version,
      cell: ({ row }) => <T id="beo-list.table.version" values={{ version: row.original.version }}>{"v{version}"}</T>,
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => beoListStatusLabels[row.status],
      cell: ({ row }) => <BeoStatusBadge status={row.original.status} />,
    },
    { id: "guests", header: "Guests", accessorFn: (row) => row.guestCount ?? "—" },
    { id: "owner", header: "Owner", accessorFn: (row) => row.owner?.name ?? "—" },
    { id: "editedBy", header: "Last edited by", accessorFn: (row) => row.lastEditedBy?.name ?? "—" },
    { id: "updated", header: "Updated", accessorFn: (row) => row.updatedAt, cell: ({ row }) => day(row.original.updatedAt) },
    {
      id: "pdf",
      header: "Saved PDF",
      accessorFn: (row) => row.pdf?.name ?? "",
      cell: ({ row }) =>
        row.original.pdf ? (
          <Link to={`/documents?document=${row.original.pdf.documentId}`} onClick={(event) => event.stopPropagation()}>
            {row.original.pdf.name}
          </Link>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <EventsHeading tab="beos" />
      <PageGrid pageKey="beos.list">
      <Block id="filters" name="Filters" h={3}>
      <FilterBar>
        <Dropdown
          variant="filter"
          aria-label="When"
          value={when}
          options={beoListWhens.map((value) => ({
            value,
            label: <LabelT id="labels.beo-list-when" value={value}>{beoListWhenLabels[value]}</LabelT>,
            text: beoListWhenLabels[value],
          }))}
          onValueChange={(next) => setWhen(next as BeoListWhen)}
        />
        <Dropdown
          variant="filter"
          aria-label="Status"
          value={status}
          options={[
            { value: "", label: <T id="beo-list.filters.all-statuses">All statuses</T>, text: "All statuses" },
            ...beoListStatuses.map((value) => ({
              value,
              label: <LabelT id="labels.beo-list-status" value={value}>{beoListStatusLabels[value]}</LabelT>,
              text: beoListStatusLabels[value],
            })),
          ]}
          onValueChange={(next) => setStatus(next as BeoListStatus | "")}
        />
        <Dropdown
          variant="filter"
          aria-label="Owner"
          value={owner}
          options={[
            { value: "", label: <T id="beo-list.filters.all-owners">All owners</T>, text: "All owners" },
            ...owners.map(([id, name]) => ({ value: id, label: name })),
          ]}
          onValueChange={setOwner}
        />
      </FilterBar>
      </Block>
      <Block id="list" name="List" h={24}>
      <ErrorText message={beos.error} />
      {!beos.data && !beos.error && <LoadingSkeleton />}
      {beos.data && (
        <DataTable
          copyKey="beo-list.table"
          openColumn
          data={beos.data}
          columns={columns}
          onRow={setSelected}
          selection={{ rowId: (row) => row.id, ...deletable }}
          label={<T id="beo-list.table.beos">BEOs</T>}
          exportName="beos"
        />
      )}
      </Block>
      </PageGrid>
      {selected && (
        <BeoPreview
          row={selected}
          onClose={() => setSelected(null)}
          onOpen={() => navigate(`/events/${selected.eventId}/beo/${selected.id}`)}
        />
      )}
    </>
  );
}

// The side preview: the BEO's first page in brief (menu, staff, timeline), the
// event date, guests, who edited it last and its saved PDF, with Open BEO, Print
// and Open in Documents.
function BeoPreview({ row, onClose, onOpen }: { row: BeoListRow; onClose: () => void; onOpen: () => void }) {
  const beo = useResource(["beo", row.eventId], () => beoApi.get(row.eventId));
  const content = beo.data?.content;
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={
        <>
          <small className="beo-preview-kicker">
            <T id="beo-list.preview.version" values={{ version: row.version }}>{"BEO v{version}"}</T>
          </small>
          {row.eventTitle}
        </>
      }
      description={<BeoStatusBadge status={row.status} />}
    >
      <div className="beo-preview-page" aria-label="BEO preview">
        <ErrorText message={beo.error} />
        {!content && !beo.error && <LoadingSkeleton />}
        {content && (
          <>
            <p>
              {content.summary.date} · {content.summary.startTime}
              {content.summary.endTime ? `–${content.summary.endTime}` : ""}
            </p>
            <p>{[content.event.venue, content.event.address].filter(Boolean).join(" · ") || "—"}</p>
            {content.foodSetup.courses.map((course) => (
              <p key={course.course}>
                <strong>{course.course}</strong> {course.lines.map((line) => line.name).join(", ")}
              </p>
            ))}
            {content.staff.shifts.length > 0 && content.staff.productionLead && (
              <p>
                <T id="beo-list.preview.lead" values={{ productionLead: content.staff.productionLead }}>{"Lead: {productionLead}"}</T>
              </p>
            )}
          </>
        )}
      </div>
      <dl className="panel-details">
        <div>
          <dt><T id="beo-list.preview.event-date">Event date</T></dt>
          <dd>{day(row.eventStartsAt)}</dd>
        </div>
        <div>
          <dt><T id="beo-list.preview.guests">Guests</T></dt>
          <dd>{row.guestCount ?? "—"}</dd>
        </div>
        <div>
          <dt><T id="beo-list.preview.last-edited-by">Last edited by</T></dt>
          <dd>{row.lastEditedBy ? `${row.lastEditedBy.name} · ${day(row.updatedAt)}` : day(row.updatedAt)}</dd>
        </div>
        <div>
          <dt><T id="beo-list.preview.saved-in-documents">Saved in Documents</T></dt>
          <dd>{row.pdf?.name ?? "—"}</dd>
        </div>
      </dl>
      <div className="panel-actions">
        <Button onClick={onOpen}><T id="beo-list.preview.open-beo">Open BEO</T></Button>
        <Button variant="outline" asChild>
          <Link to={`/print/events/${row.eventId}/beo`}><T id="beo-list.preview.print">Print</T></Link>
        </Button>
        {row.pdf && (
          <Button variant="outline" asChild>
            <Link to={`/documents?document=${row.pdf.documentId}`}><T id="beo-list.preview.open-in-documents">Open in Documents</T></Link>
          </Button>
        )}
      </div>
    </DetailDrawer>
  );
}
