import { usePermissions } from "../app/permissions";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  inviteInputSchema,
  userSchema,
  type User,
  type UserAction,
} from "../../shared/users";
import { roleSchema } from "../../shared/access";
import { useResource } from "../app/useResource";
import { request } from "../services/core";
import { Button, PageHeader, Section } from "../components/shared";

import { roleLabel } from "../services/users";
import { T } from "../app/live-copy";
const actions: Record<User["status"], UserAction[]> = {
  pending: ["resend", "revoke"],
  active: ["deactivate"],
  deactivated: ["reactivate"],
  revoked: [],
};
const labels: Record<UserAction, string> = {
  resend: "Resend invite",
  revoke: "Revoke invite",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
};

export function UserManagement() {
  const permissions = usePermissions();
  if (!permissions.can("users.manage"))
    return <p role="alert"><T id="users.user-management.only-admin-can-manage-users">Only Admin can manage users.</T></p>;
  return <UserList />;
}

function UserList() {
  // One key: after a change the list reloads in place (FLOW-189), keeping the
  // current rows on screen until the new ones arrive.
  const resource = useResource(
    ["admin-users"],
    () => request(userSchema.array(), "/api/admin/users"),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const change = async (user: User, action: UserAction) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(
        userSchema,
        `/api/admin/users/${user.id}/${action}`,
        "POST",
        {},
      );
      setNotice(
        action === "resend" ? "Invitation email sent." : "User updated.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user.");
    } finally {
      setBusy(false);
      resource.reload();
    }
  };
  return (
    <>
      <PageHeader
        title={<T id="users.user-list.users">Users</T>}
        subtitle={<T id="users.user-list.invite-staff-and-manage-their-access">Invite staff and manage their access to Flowbase.</T>}
      />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Section title={<T id="users.user-list.invite-a-user">Invite a user</T>}>
        <form
          className="user-invite-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const parsed = inviteInputSchema.safeParse(
              Object.fromEntries(new FormData(form)),
            );
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await request(
                userSchema,
                "/api/admin/users",
                "POST",
                parsed.data,
              );
              form.reset();
              setNotice(
                "Invitation email sent. The account activates on first Google sign-in.",
              );
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Unable to invite user.",
              );
            } finally {
              setBusy(false);
              resource.reload();
            }
          }}
        >
          <label>
            <T id="users.user-list.email">Email</T>
            <input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            <T id="users.user-list.role">Role</T>
            <select name="role" defaultValue="staff">
              {roleSchema.options.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <T id="users.user-list.employment-type">Employment type</T>
            <select name="employmentType">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
            </select>
          </label>
          <label>
            <T id="users.user-list.mobile-number">Mobile number</T>
            <input name="mobile" type="tel" required maxLength={40} />
          </label>
          <Button type="submit" disabled={busy}>
            <T id="users.user-list.send-invite">Send invite</T>
          </Button>
        </form>
      </Section>
      <Section title={<T id="users.user-list.staff-access">Staff access</T>}>
        {resource.error && <p role="alert"><T id="users.user-list.unable-to-load-users">Unable to load users.</T></p>}
        {!resource.data && !resource.error && (
          <p role="status"><T id="users.user-list.loading-users">Loading users…</T></p>
        )}
        {resource.data?.map((user) => (
          <article className="user-access-row" key={user.id}>
            <div>
              <strong>
                {user.status === "revoked" ? (
                  user.name
                ) : (
                  <Link to={`/staff/${user.id}`}>{user.name}</Link>
                )}
              </strong>
              <p>
                {user.email} · {roleLabel(user.role)} ·{" "}
                {user.employmentType === "full_time"
                  ? <T id="users.user-list.full-time">Full-time</T>
                  : <T id="users.user-list.part-time">Part-time</T>}
              </p>
              <p>
                {user.mobile} · {roleLabel(user.status)}
              </p>
            </div>
            <div>
              {actions[user.status].map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  disabled={busy}
                  onClick={() => void change(user, action)}
                >
                  {labels[action]}
                </Button>
              ))}
            </div>
          </article>
        ))}
        {resource.data?.length === 0 && <p><T id="users.user-list.no-users-yet">No users yet.</T></p>}
      </Section>
    </>
  );
}
