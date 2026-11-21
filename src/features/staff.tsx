import { Block, PageGrid } from "../app/page-grid";
import { Dropdown } from "../components/ui/Dropdown";

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { roleSchema, type Role } from "../../shared/access";
import type { StaffMember, StaffUpdate } from "../../shared/staff";
import { staffApi } from "../services/staff";
import {
  Button,
  DataTable,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  RoleText,
  SearchInput,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { ListCheckboxes, useListLabels } from "./list-fields";
import { roleLabel } from "../services/users";
import { dateTimeLabel } from "./inventory-labels";
import "./settings.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy } from "../app/copy";
import { userSchema } from "../../shared/users";
import { request } from "../services/core";

// Staff directory and profiles (FLOW-40): one list of staff with the positions they
// can work. Phone numbers show to FT+ and to the person; notes to FT+.

const statusLabel = (member: StaffMember) =>
  member.active
    ? "Active"
    : member.status === "pending"
      ? "Invited"
      : "Inactive";
const mobileLabel = (mobile: string | null) =>
  mobile === null ? "Hidden" : mobile || "—";

export function StaffDirectory() {
  const { actor, can } = usePermissions();
  const searchNameOrEmailPlaceholder = useCopy("staff.staff-directory.search-name-or-email.placeholder", "Search name or email…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [inactive, setInactive] = useState(false);
  const staff = useResource(
    ["staff"],
    () => staffApi.list(),
  );
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
      `${member.name} ${member.email}`.toLowerCase().includes(term),
  );
  const columns: ColumnDef<StaffMember, unknown>[] = [
    { accessorKey: "name", header: "Name", meta: { edit: "text", canEdit: () => can("users.manage"),
      onEdit: async (row, value) => { await staffApi.update(row.id, { name: value }); staff.reload(); } } },
    {
      id: "positions",
      header: "Positions",
      accessorFn: (member) => member.positions.join(", ") || "—",
      meta: { csv: (member) => member.positions.join("; "), edit: "text",
        editValue: (row) => row.positions.join(", "), canEdit: () => can("users.manage"),
        onEdit: async (row, value) => { await staffApi.update(row.id, { positions: value.split(",").map((part) => part.trim()).filter(Boolean) }); staff.reload(); } },
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (member) => roleLabel(member.role),
      cell: ({ row }) => <RoleText role={row.original.role} />,
      meta: { edit: "select", editValue: (row) => row.role, canEdit: () => can("users.manage"),
        editOptions: roleSchema.options.map((value) => ({ value, label: roleLabel(value) })),
        onEdit: async (row, value) => { await staffApi.update(row.id, { role: roleSchema.parse(value) }); staff.reload(); } },
    },
    {
      id: "mobile",
      header: "Mobile",
      accessorFn: (member) => mobileLabel(member.mobile),
      meta: {
        fieldGroup: "staff_contact",
        csv: (member) => member.mobile ?? "",
        edit: "text", editValue: (row) => row.mobile ?? "",
        canEdit: (row) => row.mobile !== null && (can("users.manage") || row.id === actor?.userId),
        onEdit: async (row, value) => { await staffApi.update(row.id, { mobile: value }); staff.reload(); },
      },
    },
    { accessorKey: "email", header: "Email", meta: { edit: "text", canEdit: () => can("users.manage"),
      onEdit: async (row, value) => { await request(userSchema, `/api/admin/users/${row.id}/email`, "PUT", { email: value }); staff.reload(); } } },
    { id: "status", header: "Status", accessorFn: statusLabel },
  ];
  return (
    <>
      <PageHeader
        title={<T id="staff.staff-directory.staff">Staff</T>}
        subtitle={<T id="staff.staff-directory.who-works-for-the-business">Who works for the business and the positions they can work.</T>}
        eyebrow={<T id="staff.staff-directory.team">TEAM</T>}
      />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchNameOrEmailPlaceholder} copyId="staff.staff-directory.search-name-or-email.placeholder"
        />
        <Dropdown
          aria-label="Position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        >
          <option value="">All positions</option>
          {positions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Dropdown>
        <label className="checkbox-filter">
          <RoundCheck
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          <T id="staff.staff-directory.show-inactive">Show inactive</T>
        </label>
        <span className="result-count"><T id="staff.staff-directory.staff-2" values={{ dataCount: data.length }}>{"{dataCount} staff"}</T></span>
      </FilterBar>
      {staff.error ? (
        <LoadError message={staff.error} />
      ) : staff.loading && !staff.data ? (
        <LoadingSkeleton />
      ) : (
<PageGrid pageKey="staff.list">
        <Block id="list" name="List" h={24}>
        <DataTable copyKey="staff.staff-directory" openColumn
          data={data}
          columns={columns}
          onRow={(member) => navigate(`/staff/${member.id}`)}
          label={<T id="staff.staff-directory.staff-3">staff</T>}
          exportName="staff"
        />
        </Block>
        </PageGrid>
      )}
    </>
  );
}

export function StaffDetail() {
  const { id = "" } = useParams();
  return (
    <>
      <Link to="/staff" className="back-link">
        <T id="staff.staff-detail.all-staff">← All staff</T>
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
  const [editing, setEditing] = useState(false);
  const member = useResource(
    ["staff", id],
    () => staffApi.get(id),
  );
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
          subtitle={<RoleText role={data.role} />}
        />
      )}
      {(manage || own) && editing ? (
        <StaffForm
          member={data}
          manage={manage}
          onSaved={(saved) => { member.replace(saved); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <StaffSummary member={data} canEdit={manage || own} onEdit={() => setEditing(true)} />
      )}
    </>
  );
}

function StaffSummary({ member, canEdit, onEdit }: { member: StaffMember; canEdit: boolean; onEdit: () => void }) {
  const positions = useListLabels("staff_position");
  return (
    <>
      <Section title={<T id="staff.staff-summary.employee-profile">Employee profile</T>}>
        {canEdit && <Button variant="outline" onClick={onEdit}><T id="staff.staff-summary.edit">Edit</T></Button>}
        <dl className="employee-profile-grid staff-profile-readonly">
          <div><dt><T id="staff.staff-summary.name">Name</T></dt><dd>{member.name}</dd></div>
          <div><dt><T id="staff.staff-summary.primary-email">Primary email</T></dt><dd>{member.email}</dd></div>
          <div><dt><T id="staff.staff-summary.mobile">Phone number</T></dt><dd>{mobileLabel(member.mobile)}</dd></div>
          <div><dt><T id="staff.staff-summary.secondary-email">Secondary email (optional)</T></dt><dd>{member.secondaryEmail || "—"}</dd></div>
        </dl>
      </Section>
      <Section title={<T id="staff.staff-profile.staff-profile">Staff profile</T>}>
        <p className="staff-role"><RoleText role={member.role} /></p>
        <div className="staff-positions-grid">{[...new Set([...positions, ...member.positions])].map((position) =>
          <label key={position}><RoundCheck checked={member.positions.includes(position)} disabled readOnly />{position}</label>)}</div>
      </Section>
    </>
  );
}

type Draft = Required<Omit<StaffUpdate, "notes">>;
const draftOf = (member: StaffMember): Draft => ({
  name: member.name,
  mobile: member.mobile ?? "",
  secondaryEmail: member.secondaryEmail ?? "",
  role: member.role,
  positions: member.positions,
  smsConsent: member.smsConsent,
});

function StaffForm({
  member,
  manage,
  onSaved,
  onCancel,
}: {
  member: StaffMember;
  manage: boolean;
  onSaved: (member: StaffMember) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(member));
  useEffect(() => setDraft(draftOf(member)), [member]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailDraft, setEmailDraft] = useState(member.email);
  const [editingEmail, setEditingEmail] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!draft.mobile.trim()) return setError("Mobile number is required.");
    if (manage && !draft.name.trim()) return setError("Name is required.");
    const input: StaffUpdate = manage
      ? { ...draft, name: draft.name.trim(), mobile: draft.mobile.trim() }
      : { mobile: draft.mobile.trim(), secondaryEmail: draft.secondaryEmail,
          smsConsent: draft.smsConsent };
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
  const saveEmail = async () => {
    setSaving(true); setError(""); setNotice("");
    try {
      await request(userSchema, `/api/admin/users/${member.id}/email`, "PUT", { email: emailDraft });
      setEditingEmail(false);
      setNotice("Contact email changed. The existing Google sign-in remains linked, and the user was notified.");
      window.location.reload();
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <form className="settings-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error && <p role="alert" className="error-message">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Section title={<T id="staff.staff-form.employee-profile">Employee profile</T>}>
        <div className="employee-profile-grid">
          <FormField label="Name"><input value={draft.name} readOnly={!manage} maxLength={200} onChange={(event) => set("name", event.target.value)} /></FormField>
          <FormField label="Primary email">{editingEmail ? <span className="email-edit-row">
            <input type="email" value={emailDraft} maxLength={254} onChange={(event) => setEmailDraft(event.target.value)} />
            <Button type="button" disabled={saving} onClick={() => void saveEmail()}><T id="staff.staff-form.save-email">Save email</T></Button>
            <Button type="button" variant="outline" onClick={() => setEditingEmail(false)}><T id="staff.staff-form.cancel-email">Cancel</T></Button>
          </span> : <span className="email-edit-row"><input type="email" value={member.email} readOnly />
            {manage && <Button type="button" variant="outline" onClick={() => setEditingEmail(true)}><T id="staff.staff-form.change-email">Change</T></Button>}</span>}</FormField>
          <FormField label="Phone number"><input type="tel" value={draft.mobile} maxLength={40} onChange={(event) => set("mobile", event.target.value)} /></FormField>
          <FormField label="Secondary email (optional)"><input type="email" value={draft.secondaryEmail ?? ""} maxLength={254} onChange={(event) => set("secondaryEmail", event.target.value)} /></FormField>
        </div>
      </Section>
      <Section title={<T id="staff.staff-form.staff-profile">Staff profile</T>}>
        <p className="staff-role"><RoleText role={draft.role} /></p>
        {manage && <FormField label="Role"><Dropdown value={draft.role} onChange={(event) => set("role", event.target.value as Role)}>
          {roleSchema.options.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </Dropdown></FormField>}
        {manage ? <ListCheckboxes list="staff_position" legend="Positions" values={draft.positions} onChange={(positions) => set("positions", positions)} /> :
          <p><T id="staff.staff-form.positions">Positions: </T>{member.positions.join(", ") || "—"}</p>}
        <label className="staff-consent"><RoundCheck checked={draft.smsConsent} onChange={(event) => set("smsConsent", event.target.checked)} /><T id="staff.staff-form.sms-consent">Text me work updates (SMS)</T></label>
        {member.smsConsentAt && <p className="settings-hint"><T id="staff.staff-form.opted-in">Opted in </T>{dateTimeLabel(member.smsConsentAt)}.</p>}
        <div className="form-actions"><Button type="submit" disabled={saving}><T id="staff.staff-form.save">Save profile</T></Button><Button type="button" variant="outline" onClick={onCancel}><T id="staff.staff-form.cancel">Cancel</T></Button></div>
      </Section>
    </form>
  );
}
