import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { roleSchema, type EmploymentType, type Role } from "../../shared/access";
import type { StaffMember, StaffUpdate } from "../../shared/staff";
import { staffApi } from "../services/staff";
import {
  Button,
  DataTable,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  SearchInput,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { ListCheckboxes, useListLabels } from "./list-fields";
import { roleLabel } from "../services/users";
import { dateTimeLabel } from "./inventory-labels";
import "./settings.css";

// Staff directory and profiles (FLOW-40): one list of staff with the positions they
// can work. Phone numbers show to FT+ and to the person; notes to FT+.

const employmentLabels: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
};
const statusLabel = (member: StaffMember) =>
  member.active
    ? "Active"
    : member.status === "pending"
      ? "Invited"
      : "Inactive";
const mobileLabel = (mobile: string | null) =>
  mobile === null ? "Hidden" : mobile || "—";

export function StaffDirectory() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [employment, setEmployment] = useState<EmploymentType | "">("");
  const [inactive, setInactive] = useState(false);
  const staff = useResource(() => staffApi.list(), []);
  const listed = useListLabels("staff_position");
  const positions = [
    ...new Set([
      ...listed,
      ...(staff.data ?? []).flatMap((member) => member.positions),
    ]),
  ];
  const term = search.toLowerCase();
  const data = (staff.data ?? []).filter(
    (member) =>
      (inactive || member.active) &&
      (!position || member.positions.includes(position)) &&
      (!employment || member.employmentType === employment) &&
      `${member.name} ${member.email}`.toLowerCase().includes(term),
  );
  const columns: ColumnDef<StaffMember, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    {
      id: "positions",
      header: "Positions",
      accessorFn: (member) => member.positions.join(", ") || "—",
      meta: { csv: (member) => member.positions.join("; ") },
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (member) => roleLabel(member.role),
    },
    {
      id: "employment",
      header: "Employment",
      accessorFn: (member) => employmentLabels[member.employmentType],
    },
    {
      id: "mobile",
      header: "Mobile",
      accessorFn: (member) => mobileLabel(member.mobile),
      meta: {
        fieldGroup: "staff_contact",
        csv: (member) => member.mobile ?? "",
      },
    },
    { accessorKey: "email", header: "Email" },
    { id: "status", header: "Status", accessorFn: statusLabel },
  ];
  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Who works for the business and the positions they can work."
        eyebrow="TEAM"
      />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or email…"
        />
        <select
          aria-label="Position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        >
          <option value="">All positions</option>
          {positions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <select
          aria-label="Employment type"
          value={employment}
          onChange={(e) => setEmployment(e.target.value as EmploymentType | "")}
        >
          <option value="">All employment types</option>
          {Object.entries(employmentLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <span className="result-count">{data.length} staff</span>
      </FilterBar>
      {staff.error ? (
        <LoadError message={staff.error} />
      ) : staff.loading && !staff.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(member) => navigate(`/staff/${member.id}`)}
          label="staff"
          exportName="staff"
        />
      )}
    </>
  );
}

export function StaffDetail() {
  const { id = "" } = useParams();
  return (
    <>
      <Link to="/staff" className="back-link">
        ← All staff
      </Link>
      <StaffProfile id={id} />
    </>
  );
}

// One staff member's profile. Admin edits everything; the person edits their own
// phone number and SMS consent; everyone else reads it.
export function StaffProfile({
  id,
  heading = true,
}: {
  id: string;
  heading?: boolean;
}) {
  const permissions = usePermissions();
  const member = useResource(() => staffApi.get(id), [id]);
  if (member.error) return <LoadError message={member.error} />;
  if (!member.data) return <LoadingSkeleton />;
  const data = member.data;
  const manage = permissions.can("users.manage");
  const own = permissions.actor?.userId === data.id;
  return (
    <>
      {heading && (
        <PageHeader
          title={data.name}
          subtitle={`${roleLabel(data.role)} · ${employmentLabels[data.employmentType]}`}
        />
      )}
      {manage || own ? (
        <StaffForm
          member={data}
          manage={manage}
          onSaved={(saved) => member.replace(saved)}
        />
      ) : (
        <Section title="Staff profile">
          <StaffSummary member={data} />
        </Section>
      )}
    </>
  );
}

function StaffSummary({ member }: { member: StaffMember }) {
  return (
    <div className="staff-detail">
      <dl>
        <dt>Email</dt>
        <dd>{member.email}</dd>
        <dt>Mobile</dt>
        <dd>{mobileLabel(member.mobile)}</dd>
        <dt>Positions</dt>
        <dd>{member.positions.join(", ") || "—"}</dd>
        <dt>Status</dt>
        <dd>{statusLabel(member)}</dd>
        {member.notes !== null && (
          <>
            <dt>Notes</dt>
            <dd>{member.notes || "—"}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

type Draft = Required<Omit<StaffUpdate, "notes">> & { notes: string };
const draftOf = (member: StaffMember): Draft => ({
  name: member.name,
  mobile: member.mobile ?? "",
  role: member.role,
  employmentType: member.employmentType,
  positions: member.positions,
  notes: member.notes ?? "",
  smsConsent: member.smsConsent,
});

function StaffForm({
  member,
  manage,
  onSaved,
}: {
  member: StaffMember;
  manage: boolean;
  onSaved: (member: StaffMember) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(member));
  useEffect(() => setDraft(draftOf(member)), [member]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!draft.mobile.trim()) return setError("Mobile number is required.");
    if (manage && !draft.name.trim()) return setError("Name is required.");
    const input: StaffUpdate = manage
      ? { ...draft, name: draft.name.trim(), mobile: draft.mobile.trim() }
      : { mobile: draft.mobile.trim(), smsConsent: draft.smsConsent };
    setSaving(true);
    setError("");
    setNotice("");
    try {
      onSaved(await staffApi.update(member.id, input));
      setNotice("Profile saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title={manage ? "Staff profile" : "Your contact details"}>
      <form
        className="settings-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="staff-detail">
          <dl>
            <dt>Email</dt>
            <dd>{member.email}</dd>
            <dt>Status</dt>
            <dd>{statusLabel(member)}</dd>
            {!manage && (
              <>
                <dt>Positions</dt>
                <dd>{member.positions.join(", ") || "—"}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="form-grid">
          {manage && (
            <FormField label="Name *">
              <input
                value={draft.name}
                maxLength={200}
                onChange={(e) => set("name", e.target.value)}
              />
            </FormField>
          )}
          <FormField label="Mobile number *">
            <input
              type="tel"
              value={draft.mobile}
              maxLength={40}
              onChange={(e) => set("mobile", e.target.value)}
            />
          </FormField>
          {manage && (
            <>
              <FormField label="Role">
                <select
                  value={draft.role}
                  onChange={(e) => set("role", e.target.value as Role)}
                >
                  {roleSchema.options.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Employment type">
                <select
                  value={draft.employmentType}
                  onChange={(e) =>
                    set("employmentType", e.target.value as EmploymentType)
                  }
                >
                  {Object.entries(employmentLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}
        </div>
        <label className="staff-consent">
          <input
            type="checkbox"
            checked={draft.smsConsent}
            onChange={(e) => set("smsConsent", e.target.checked)}
          />
          Text me work updates (SMS). Reply STOP to any text to opt out.
        </label>
        {member.smsConsentAt && (
          <p className="settings-hint">
            Opted in {dateTimeLabel(member.smsConsentAt)}.
          </p>
        )}
        {manage && (
          <>
            <ListCheckboxes
              list="staff_position"
              legend="Positions"
              values={draft.positions}
              onChange={(positions) => set("positions", positions)}
            />
            <FormField label="Notes" hint="Seen by full-time staff and above.">
              <textarea
                rows={3}
                maxLength={5000}
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </FormField>
          </>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={saving}>
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}
