import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import type {
  Notification,
  NotificationInbox,
  NotificationPreference,
} from "../../../shared/notifications";
import { queryClient } from "../../app/queryClient";
import { useResource } from "../../app/useResource";
import { Button, DetailDrawer, LoadingSkeleton, Section } from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { notificationsApi } from "../../services/notifications";
import { dateTimeLabel } from "../inventory/inventory-labels";
import "./notifications.css";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";

// Notification center and email preferences (FLOW-43). The bell shows the unread
// count; opening a notification marks it read and goes to its record.

const INBOX_KEY = ["notifications", "inbox"];
// Notifications are created by the cron, which sends no "changed" ping, so the
// bell also checks on its own while the page is visible.
const POLL_MS = 60_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const inbox = useQuery(
    {
      queryKey: INBOX_KEY,
      queryFn: () => notificationsApi.inbox(),
      refetchInterval: POLL_MS,
      retry: false,
    },
    queryClient,
  );
  const show = (value: NotificationInbox) =>
    queryClient.setQueryData(INBOX_KEY, value);
  const unread = inbox.data?.unreadCount ?? 0;
  const openNotification = async (notification: Notification) => {
    setError("");
    try {
      if (!notification.readAt) {
        await notificationsApi.markRead(notification.id);
        void inbox.refetch();
      }
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (notification.link) {
      setOpen(false);
      navigate(notification.link);
    }
  };
  const readAll = async () => {
    setError("");
    try {
      show(await notificationsApi.markAllRead());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="notification-button"
        onClick={() => {
          setOpen(true);
          void inbox.refetch();
        }}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      <DetailDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={<T id="notifications.notification-bell.notifications">Notifications</T>}
        description={
          unread ? <T id="notifications.notification-bell.unread" values={{ unread }}>{"{unread} unread"}</T> : <T id="notifications.notification-bell.things-that-need-your-attention">Things that need your attention.</T>
        }
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {inbox.error && !inbox.data ? (
          <p role="alert" className="error-message">
            <T id="notifications.notification-bell.notifications-couldn-t-load" values={{ message: inbox.error.message }}>{"Notifications couldn't load. {message}"}</T>
          </p>
        ) : !inbox.data ? (
          <LoadingSkeleton />
        ) : (
          <>
            <div className="notification-actions">
              {unread > 0 && (
                <Button variant="outline" onClick={() => void readAll()}>
                  <T id="notifications.notification-bell.mark-all-as-read">Mark all as read</T>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  navigate("/profile");
                }}
              >
                <T id="notifications.notification-bell.email-settings">Email settings</T>
              </Button>
            </div>
            {inbox.data.notifications.length ? (
              <ul className="notification-list">
                {inbox.data.notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      className={`notification-item${notification.readAt ? "" : " unread"}`}
                      onClick={() => void openNotification(notification)}
                    >
                      {!notification.readAt && (
                        <span className="notification-unread-dot">
                          <span className="sr-only"><T id="notifications.notification-bell.unread-2">{"Unread: "}</T></span>
                        </span>
                      )}
                      <span>
                        <strong>{notification.title}</strong>
                        {notification.body && <span>{notification.body}</span>}
                        <small>{dateTimeLabel(notification.createdAt)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notification-empty"><T id="notifications.notification-bell.you-re-all-caught-up">{"You're all caught up."}</T></p>
            )}
          </>
        )}
      </DetailDrawer>
    </>
  );
}

// Email on or off per notification type, on the profile page. In-app
// notifications are always on.
export function NotificationSettings() {
  const preferences = useResource(["notifications", "preferences"], () =>
    notificationsApi.preferences(),
  );
  const [draft, setDraft] = useState<Record<string, { email: boolean; sms: boolean }>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (preferences.data)
      setDraft(
        Object.fromEntries(preferences.data.map((p) => [p.type, { email: p.email, sms: p.sms }])),
      );
  }, [preferences.data]);
  if (preferences.error) return <LoadError message={preferences.error} />;
  if (!preferences.data) return <LoadingSkeleton />;
  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      preferences.replace(await notificationsApi.setPreferences({
        email: Object.fromEntries(Object.entries(draft).map(([type, value]) => [type, value.email])),
        sms: Object.fromEntries(Object.entries(draft).map(([type, value]) => [type, value.sms])),
      }));
      setNotice("Notification settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <PageGrid pageKey="notifications.settings">
    <Block id="preferences" name="Notification preferences" h={18}>
    <Section title={<T id="notifications.settings.title">Notifications</T>}>
        <form
          className="notification-settings"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="notification-hint">
            <T id="notifications.settings.hint">Notifications always appear in the app. Choose Email and SMS for each update.</T>
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <ul>
            {preferences.data.map((preference: NotificationPreference) => (
              <li key={preference.type}>
                  <span className="notification-settings__text">
                    <strong>
                      {preference.label}
                      {preference.urgent && (
                        <span className="notification-urgent"><T id="notifications.notification-settings.urgent">Urgent</T></span>
                      )}
                    </strong>
                    <small>{preference.description}</small>
                  </span>
                <span className="notification-settings__channels">
                  {(["email", "sms"] as const).map((channel) => <label key={channel}>
                    <RoundCheck aria-label={`${preference.label} ${channel.toUpperCase()}`}
                      checked={draft[preference.type]?.[channel] ?? preference[channel]}
                      onChange={(event) => setDraft((current) => ({ ...current,
                        [preference.type]: { ...(current[preference.type] ?? { email: preference.email, sms: preference.sms }), [channel]: event.target.checked },
                      }))} />
                    <T id={`notifications.settings.${channel}`}>{channel.toUpperCase()}</T>
                  </label>)}
                </span>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? <T id="notifications.settings.saving">Saving…</T> : <T id="notifications.settings.save">Save notification settings</T>}
            </Button>
          </div>
        </form>
    </Section>
    </Block>
    </PageGrid>
  );
}
