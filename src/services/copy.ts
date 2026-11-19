import { copyOverridesSchema, type CopyEdit } from "../../shared/copy";
import { request } from "./core";

// Live text editing (FLOW-240): the admin's overrides of built-in wording.
export const copyApi = {
  list: () => request(copyOverridesSchema, "/api/copy"),
  save: (edits: CopyEdit[]) => request(copyOverridesSchema, "/api/copy", "PUT", edits),
  reset: (key: string) =>
    request(copyOverridesSchema, `/api/copy/${encodeURIComponent(key)}`, "DELETE"),
};
