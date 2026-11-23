import { type SourceDef } from "./types";
import { documentTypeLabels } from "../documents";
export const documentFields: SourceDef = {
  key: "documents", label: "Documents", readAction: "attachments.read",
  listPath: "/api/documents", detailPath: (id) => `/api/documents/${encodeURIComponent(id)}`,
  recordRoute: () => "/documents", titleField: "name",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, sortable: true, filterable: true },
    { key: "docType", label: "Type", type: "status", sortable: true, filterable: true,
      options: { labels: documentTypeLabels, copyId: "labels.document-type" } },
    { key: "recordType", label: "Linked record type", type: "text", filterable: true },
    { key: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true },
    { key: "protected", label: "Kept permanently", type: "boolean", filterable: true },
  ],
};
