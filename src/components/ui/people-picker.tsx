import type { StaffMember } from "../../../shared/staff";
import { T } from "../../app/copy";
import { Dropdown } from "./Dropdown";

type Person = Pick<StaffMember, "id" | "name" | "active" | "hasAccount" | "role">;

export function peopleOptions(staff: Person[], kind: "assignees" | "managers") {
  return staff.filter((person) => person.active && (kind === "assignees" || (person.hasAccount && person.role === "admin")));
}

export function PeoplePicker({ staff, kind, value, onChange, label }: {
  staff: Person[];
  kind: "assignees" | "managers";
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  return <Dropdown multiple checkboxes searchable aria-label={label} value={value}
    onValueChange={onChange}
    options={peopleOptions(staff, kind).map((person) => ({
      value: person.id,
      text: person.name,
      label: <>{person.name}{!person.hasAccount && <small> <T id="shared.people-picker.no-account">No account</T></small>}</>,
    }))}
  />;
}
