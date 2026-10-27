import { useEffect, useState } from "react";
import {
  businessDefaultsSchema,
  businessSettingsSchema,
  companyProfileSchema,
  fallbackSettings,
  listValueSchema,
  settingsHistoryEntrySchema,
  type BusinessDefaults,
  type BusinessSettings,
  type CompanyProfile,
  type ListKey,
} from "../../shared/settings";
import { request } from "./core";

// Business settings and lists (FLOW-45). Loaded once per page and shared by every
// form; Admin's changes refresh the shared copy. Until they load, or when they
// can't be loaded, screens use the built-in defaults.
let current: BusinessSettings | null = null;
let loading: Promise<BusinessSettings> | null = null;
const listeners = new Set<(settings: BusinessSettings) => void>();
const publish = (settings: BusinessSettings) => {
  current = settings;
  for (const listener of listeners) listener(settings);
  return settings;
};

function loadSettings(force = false): Promise<BusinessSettings> {
  if (current && !force) return Promise.resolve(current);
  if (loading && !force) return loading;
  const pending = request(businessSettingsSchema, "/api/settings")
    .then(publish)
    .finally(() => {
      if (loading === pending) loading = null;
    });
  loading = pending;
  return pending;
}

export function useBusinessSettings(): BusinessSettings {
  const [settings, setSettings] = useState(current ?? fallbackSettings);
  useEffect(() => {
    listeners.add(setSettings);
    loadSettings().catch(() => {
      // The built-in defaults stay in use; the next screen tries again.
    });
    return () => {
      listeners.delete(setSettings);
    };
  }, []);
  return settings;
}


const refresh = async <T>(result: Promise<T>) => {
  const value = await result;
  await loadSettings(true).catch(() => undefined);
  return value;
};
const value = (id: string) => `/api/settings/values/${encodeURIComponent(id)}`;
export const settingsApi = {
  load: () => loadSettings(true),
  history: () =>
    request(settingsHistoryEntrySchema.array(), "/api/settings/history"),
  saveCompany: (input: CompanyProfile) =>
    refresh(request(companyProfileSchema, "/api/settings/company", "PUT", input)),
  saveDefaults: (input: BusinessDefaults) =>
    refresh(
      request(businessDefaultsSchema, "/api/settings/defaults", "PUT", input),
    ),
  addValue: (key: ListKey, label: string) =>
    refresh(
      request(listValueSchema, `/api/settings/lists/${key}`, "POST", { label }),
    ),
  renameValue: (id: string, label: string) =>
    refresh(request(listValueSchema, value(id), "PATCH", { label })),
  setArchived: (id: string, archived: boolean) =>
    refresh(
      request(
        listValueSchema,
        `${value(id)}/${archived ? "archive" : "restore"}`,
        "POST",
        {},
      ),
    ),
  order: (key: ListKey, ids: string[]) =>
    refresh(
      request(
        listValueSchema.array(),
        `/api/settings/lists/${key}/order`,
        "PUT",
        { ids },
      ),
    ),
};
