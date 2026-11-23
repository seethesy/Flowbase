import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Block, PageGrid } from "../app/page-grid";
import { T } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import {
  Button,
  DataTable,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { Dropdown } from "../components/ui/Dropdown";
import {
  dollars,
  hoursLabel,
  payTypeLabels,
  payTypeSchema,
  payTypes,
  rateLabel,
  type PayException,
  type PayrollRow,
} from "../../shared/staff-pay";
import { utcToBusinessTime } from "../../shared/time";
import { eventsApi } from "../services/core";
import { staffPayApi } from "../services/staff-pay";
import "./staff.css";

// Staffing › Payroll (FLOW-270): Admin and Technical only (the Staff pay area).
// Each person's pay type, rate and second rate, edited inline; hours worked
// from time tracking (FLOW-167/202); and pay per event or per project as
// exceptions to the normal rate. Pay is linked by the staff member's full name.

// "28" or "28.50" dollars to cents; blank clears it.
const toCents = (value: string) => {
  const trimmed = value.replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter an amount in dollars, like 28.00.");
  return Math.round(amount * 100);
};
const centsText = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export function PayrollPage() {
  const { can } = usePermissions();
  const today = utcToBusinessTime(new Date()).date;
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [error, setError] = useState("");
  const payroll = useResource(["staff-pay", from, to], () => staffPayApi.get(from, to));
  const edit = can("staff.pay.write");
  if (!can("staff.pay.read")) return <LoadError message="Only Admin and Technical can see pay." />;
  const save = async (row: PayrollRow, change: Partial<Pick<PayrollRow, "payType" | "rateCents" | "secondRateCents" | "secondRateLabel">>) => {
    setError("");
    try {
      await staffPayApi.save({
        staffFullName: row.staffFullName,
        payType: row.payType,
        rateCents: row.rateCents,
        secondRateCents: row.secondRateCents,
        secondRateLabel: row.secondRateLabel,
        ...change,
      });
    } catch (e) {
      setError((e as Error).message);
    }
    payroll.reload();
  };
  const exceptionsOf = (name: string) =>
    (payroll.data?.exceptions ?? []).filter((item) => item.staffFullName.toLowerCase() === name.toLowerCase());
  const columns: ColumnDef<PayrollRow, unknown>[] = [
    {
      accessorKey: "staffFullName",
      header: "Name",
      cell: ({ row }) => row.original.staffId
        ? <Link className="table-link" to={`/staff/${row.original.staffId}`}>{row.original.staffFullName}</Link>
        : <span title="No staff member has this name">{row.original.staffFullName}</span>,
      meta: { opensRecord: true },
    },
    {
      id: "payType",
      header: "Pay type",
      accessorFn: (row) => (row.payType ? payTypeLabels[row.payType] : ""),
      meta: { edit: "select", editValue: (row) => row.payType ?? "", canEdit: () => edit,
        editOptions: payTypes.map((value) => ({ value, label: payTypeLabels[value] })),
        onEdit: (row, value) => save(row, { payType: value ? payTypeSchema.parse(value) : null }) },
    },
    {
      id: "rate",
      header: "Rate",
      accessorFn: (row) => rateLabel(row.rateCents, row.rateUnit),
      meta: { edit: "text", editValue: (row) => centsText(row.rateCents), canEdit: () => edit,
        csv: (row) => centsText(row.rateCents),
        onEdit: async (row, value) => {
          try { await save(row, { rateCents: toCents(value) }); } catch (e) { setError((e as Error).message); }
        } },
    },
    {
      id: "secondRate",
      header: "Second rate",
      accessorFn: (row) => rateLabel(row.secondRateCents, row.rateUnit ?? "hour", row.secondRateLabel),
      meta: { edit: "text", editValue: (row) => centsText(row.secondRateCents), canEdit: () => edit,
        csv: (row) => centsText(row.secondRateCents),
        onEdit: async (row, value) => {
          try { await save(row, { secondRateCents: toCents(value) }); } catch (e) { setError((e as Error).message); }
        } },
    },
    {
      id: "secondRateLabel",
      header: "Second rate for",
      accessorKey: "secondRateLabel",
      meta: { edit: "text", canEdit: () => edit,
        onEdit: (row, value) => save(row, { secondRateLabel: value.trim() }) },
    },
    { id: "hours", header: "Hours worked", accessorFn: (row) => hoursLabel(row.workedSeconds),
      meta: { csv: (row) => (row.workedSeconds / 3600).toFixed(2) } },
    { id: "exceptions", header: "Exceptions", accessorFn: (row) => exceptionsOf(row.staffFullName).length || "" },
  ];
  return (
    <>
      <PageHeader
        title={<T id="payroll.payroll-page.payroll">Payroll</T>}
        subtitle={<T id="payroll.payroll-page.pay-rates-hours">Pay rates, hours worked and pay exceptions. Only Admin and Technical see this tab.</T>}
        eyebrow={<T id="payroll.payroll-page.staffing">STAFFING</T>}
      />
      <FilterBar>
        <FormField label={<T id="payroll.payroll-page.from">Hours from</T>}>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </FormField>
        <FormField label={<T id="payroll.payroll-page.to">to</T>}>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </FormField>
      </FilterBar>
      {error && <p role="alert" className="error-message">{error}</p>}
      {payroll.error ? (
        <LoadError message={payroll.error} />
      ) : !payroll.data ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="staff.payroll">
          <Block id="pay" name="Pay" h={22}>
            <Section title={<T id="payroll.payroll-page.pay">Pay</T>}>
              <DataTable copyKey="payroll.pay" data={payroll.data.rows} columns={columns}
                label={<T id="payroll.payroll-page.staff">staff</T>} exportName="payroll" />
            </Section>
          </Block>
          <Block id="exceptions" name="Pay exceptions" h={16}>
            <PayExceptions exceptions={payroll.data.exceptions} names={payroll.data.rows.map((row) => row.staffFullName)}
              from={from} to={to} edit={edit} onChanged={() => payroll.reload()} />
          </Block>
        </PageGrid>
      )}
    </>
  );
}

// Pay per event and pay per project that differ from the person's normal rate.
function PayExceptions({ exceptions, names, from, to, edit, onChanged }: {
  exceptions: PayException[];
  names: string[];
  from: string;
  to: string;
  edit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const remove = async (item: PayException) => {
    setError("");
    try { await staffPayApi.removeException(item.id); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  const columns: ColumnDef<PayException, unknown>[] = [
    { accessorKey: "staffFullName", header: "Name" },
    { id: "for", header: "Event or project", accessorFn: (item) => item.eventTitle ?? item.project ?? "" },
    { id: "amount", header: "Amount", accessorFn: (item) => dollars(item.amountCents),
      meta: { edit: "text", editValue: (item) => centsText(item.amountCents), canEdit: () => edit,
        csv: (item) => centsText(item.amountCents),
        onEdit: async (item, value) => {
          setError("");
          try { await staffPayApi.updateException(item.id, { amountCents: toCents(value) ?? 0 }); onChanged(); }
          catch (e) { setError((e as Error).message); }
        } } },
    { accessorKey: "note", header: "Note", meta: { edit: "text", canEdit: () => edit,
      onEdit: async (item, value) => { await staffPayApi.updateException(item.id, { note: value }); onChanged(); } } },
    ...(edit ? [{ id: "remove", header: "", enableSorting: false, meta: { exportable: false },
      cell: ({ row }: { row: { original: PayException } }) => (
        <Button variant="outline" onClick={() => void remove(row.original)}><T id="payroll.pay-exceptions.remove">Remove</T></Button>
      ) } satisfies ColumnDef<PayException, unknown>] : []),
  ];
  return (
    <Section title={<T id="payroll.pay-exceptions.pay-exceptions">Pay exceptions</T>}
      action={edit && !adding ? <Button variant="outline" onClick={() => setAdding(true)}><T id="payroll.pay-exceptions.add-exception">Add exception</T></Button> : undefined}>
      {error && <p role="alert" className="error-message">{error}</p>}
      {adding && <ExceptionForm names={names} from={from} to={to} onCancel={() => setAdding(false)}
        onSaved={() => { setAdding(false); onChanged(); }} />}
      {exceptions.length
        ? <DataTable copyKey="payroll.exceptions" data={exceptions} columns={columns}
            label={<T id="payroll.pay-exceptions.exceptions">exceptions</T>} exportName="pay-exceptions" />
        : <p><T id="payroll.pay-exceptions.none">No pay exceptions. Add one when someone is paid differently for an event or a project.</T></p>}
    </Section>
  );
}

function ExceptionForm({ names, from, to, onCancel, onSaved }: {
  names: string[];
  from: string;
  to: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(names[0] ?? "");
  const [kind, setKind] = useState<"event" | "project">("event");
  const [eventId, setEventId] = useState("");
  const [project, setProject] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Events in the payroll's dates.
  const events = useResource(["staff-pay", "events", from, to], async () => (await eventsApi.list({ from, to })).rows);
  const save = async () => {
    setError("");
    try {
      const amountCents = toCents(amount);
      if (amountCents === null) return setError("Enter the amount.");
      if (kind === "event" && !eventId) return setError("Choose the event.");
      if (kind === "project" && !project.trim()) return setError("Name the project.");
      setSaving(true);
      await staffPayApi.addException({
        staffFullName: name,
        eventId: kind === "event" ? eventId : null,
        project: kind === "project" ? project.trim() : null,
        amountCents,
        note,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="settings-form payroll-exception-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error && <p role="alert" className="error-message">{error}</p>}
      <FormField label="Name">
        <Dropdown aria-label="Name" value={name} onChange={(e) => setName(e.target.value)}>
          {names.map((option) => <option key={option} value={option}>{option}</option>)}
        </Dropdown>
      </FormField>
      <FormField label="For">
        <Dropdown aria-label="For" value={kind} onChange={(e) => setKind(e.target.value === "project" ? "project" : "event")}>
          <option value="event">An event</option>
          <option value="project">A project</option>
        </Dropdown>
      </FormField>
      {kind === "event" ? (
        <FormField label="Event">
          <Dropdown aria-label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Choose an event</option>
            {(events.data ?? []).map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </Dropdown>
        </FormField>
      ) : (
        <FormField label="Project"><input value={project} maxLength={200} onChange={(e) => setProject(e.target.value)} /></FormField>
      )}
      <FormField label="Amount ($)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
      <FormField label="Note"><input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></FormField>
      <div className="form-actions">
        <Button type="submit" disabled={saving}><T id="payroll.exception-form.save">Save exception</T></Button>
        <Button type="button" variant="outline" onClick={onCancel}><T id="payroll.exception-form.cancel">Cancel</T></Button>
      </div>
    </form>
  );
}
