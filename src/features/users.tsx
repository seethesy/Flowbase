import { useState } from "react";
import {
  inviteInputSchema,
  userSchema,
  type User,
  type UserAction,
} from "../../shared/users";
import { roleSchema } from "../../shared/access";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { request } from "../services/core";
import { Button, PageHeader, Section } from "../components/shared";

export const roleLabel = (role: string) =>
  role
    .split("_")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
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
  const auth = useAuth();
  if (auth?.user.role !== "admin")
    return <p role="alert">Only Admin can manage users.</p>;
  return <UserList />;
}

function UserList() {
  const [version, setVersion] = useState(0);
  const resource = useResource(
    () => request(userSchema.array(), "/api/admin/users"),
    [version],
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
      setVersion((v) => v + 1);
    }
  };
  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Invite staff and manage their access to Flowbase."
      />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Section title="Invite a user">
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
              setVersion((v) => v + 1);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            Role
            <select name="role" defaultValue="staff">
              {roleSchema.options.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employment type
            <select name="employmentType">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
            </select>
          </label>
          <label>
            Mobile number
            <input name="mobile" type="tel" required maxLength={40} />
          </label>
          <Button type="submit" disabled={busy}>
            Send invite
          </Button>
        </form>
      </Section>
      <Section title="Staff access">
        {resource.error && <p role="alert">Unable to load users.</p>}
        {!resource.data && !resource.error && (
          <p role="status">Loading users…</p>
        )}
        {resource.data?.map((user) => (
          <article className="user-access-row" key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <p>
                {user.email} · {roleLabel(user.role)} ·{" "}
                {user.employmentType === "full_time"
                  ? "Full-time"
                  : "Part-time"}
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
        {resource.data?.length === 0 && <p>No users yet.</p>}
      </Section>
    </>
  );
}
