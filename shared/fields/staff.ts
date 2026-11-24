import { isFtPlus } from "../access";
import { can } from "../policy";
import { payTypeLabels } from "../staff-pay";
import { canSeeField } from "../visibility";
import { type SourceDef } from "./types";

const roleLabels = {
  admin: "Admin",
  technical: "Technical",
  sales_manager: "Sales Manager",
  salesperson: "Salesperson",
  kitchen_lead: "Kitchen Lead",
  kitchen_staff: "Kitchen Staff",
  staff: "Staff",
  part_time_staff: "Part Time Staff",
};

export const staffFields: SourceDef = {
  key: "staff",
  label: "Staff",
  readAction: "staff.read",
  listPath: "/api/staff",
  detailPath: (id) => `/api/staff/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/staff/${row.id}` : null),
  titleField: "name",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, sortable: true, filterable: true },
    {
      key: "role",
      label: "Role",
      type: "status",
      options: { labels: roleLabels, copyId: "labels.role" },
      sortable: true,
      filterable: true,
    },
    { key: "email", label: "Email", type: "text", sortable: true, filterable: true },
    {
      key: "mobile",
      label: "Mobile",
      type: "text",
      // FT+ and the person themselves (FLOW-40 AC3).
      read: (actor, row) =>
        canSeeField(actor, "staff_contact", { subjectUserId: row ? (row.id as string) : null }),
      filterable: true,
    },
    { key: "positions", label: "Positions", type: "text", filterable: true },
    {
      key: "status",
      label: "Account status",
      type: "status",
      options: {
        labels: { pending: "Pending", active: "Active", deactivated: "Deactivated" },
        copyId: "labels.user-status",
      },
      sortable: true,
      filterable: true,
    },
    { key: "active", label: "Active", type: "boolean", filterable: true },
    // Profile details (FLOW-333): address and staff ID follow the mobile
    // number's rule; drives and has a car are readable by everyone.
    {
      key: "address",
      label: "Address",
      type: "text",
      read: (actor, row) =>
        canSeeField(actor, "staff_contact", { subjectUserId: row ? (row.id as string) : null }),
      filterable: true,
    },
    {
      key: "employeeId",
      label: "Staff ID",
      type: "text",
      read: (actor, row) =>
        canSeeField(actor, "staff_contact", { subjectUserId: row ? (row.id as string) : null }),
      sortable: true,
      filterable: true,
    },
    { key: "drives", label: "Drives", type: "boolean", filterable: true },
    { key: "hasCar", label: "Has a car", type: "boolean", filterable: true },
    // Notes about a staff member: FT+ only.
    { key: "notes", label: "Notes", type: "text", read: isFtPlus },
    // Staff pay (FLOW-270): unreadable to everyone without the Staff pay area
    // (Admin and Technical by default); the API never sends it to them.
    {
      key: "payType",
      label: "Pay type",
      type: "status",
      options: { labels: payTypeLabels, copyId: "labels.pay-type" },
      read: (actor) => can(actor, "staff.pay.read"),
    },
    { key: "payRate", label: "Rate", type: "text", read: (actor) => can(actor, "staff.pay.read") },
  ],
};
