import { z } from "zod";
import {
  notificationInboxSchema,
  notificationPreferenceSchema,
  notificationSchema,
  type NotificationPreferencesInput,
} from "../../shared/notifications";
import { request } from "./core";

// The signed-in user's notification center and email preferences (FLOW-43).
const base = "/api/notifications";
export const notificationsApi = {
  inbox: () => request(notificationInboxSchema, base),
  markRead: (id: string) =>
    request(notificationSchema, `${base}/${encodeURIComponent(id)}/read`, "POST", {}),
  markAllRead: () => request(notificationInboxSchema, `${base}/read-all`, "POST", {}),
  preferences: () =>
    request(z.array(notificationPreferenceSchema), `${base}/preferences`),
  setPreferences: (input: NotificationPreferencesInput) =>
    request(
      z.array(notificationPreferenceSchema),
      `${base}/preferences`,
      "PUT",
      input,
    ),
};
