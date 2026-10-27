import { Allowed } from "../app/permissions";
import { attachmentWriteActions } from "../../shared/policy";
import { useRef, useState } from "react";
import { FileText, Upload, Trash2 } from "lucide-react";
import type {
  Attachment,
  AttachmentRecordType,
} from "../../shared/attachments";
import { attachmentsApi, uploadAttachment } from "../services/attachments";
import { useResource } from "../app/useResource";
import { Button, Section } from "../components/shared";
import { LoadError } from "./clients";
import "./attachments.css";

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,application/pdf,.docx";

// Photos and documents attached to a record (FLOW-42). Signed links expire after
// a few minutes, so the list reloads them on every visit.
export function Attachments({
  recordType,
  recordId,
  group = "",
  title = "Files",
}: {
  recordType: AttachmentRecordType;
  recordId: string;
  group?: string;
  title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const files = useResource(
    () => attachmentsApi.list(recordType, recordId),
    [recordType, recordId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = (files.data ?? []).filter((file) => file.group === group);
  const upload = async (picked: FileList | null) => {
    setError("");
    setBusy(true);
    try {
      for (const file of picked ?? [])
        await uploadAttachment(file, { recordType, recordId, group });
      files.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const archive = async (file: Attachment) => {
    try {
      await attachmentsApi.archive(file.id);
      files.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Section
      title={title}
      action={
        <Allowed action={attachmentWriteActions[recordType]}>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            aria-label={`Add to ${title}`}
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={14} />
            {busy ? "Uploading…" : "Add files"}
          </Button>
        </Allowed>
      }
    >
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {files.error ? (
        <LoadError message={files.error} />
      ) : shown.length ? (
        <ul className="attachment-grid">
          {shown.map((file) => (
            <li key={file.id}>
              {file.kind === "photo" ? (
                <a href={file.urls.display} target="_blank" rel="noreferrer">
                  <img src={file.urls.thumb} alt={file.caption || file.fileName} />
                </a>
              ) : (
                <a href={file.urls.original} target="_blank" rel="noreferrer">
                  <FileText size={28} />
                  <span>{file.fileName}</span>
                </a>
              )}
              <small>{file.caption || file.fileName}</small>
              <Allowed action={attachmentWriteActions[recordType]}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${file.fileName}`}
                  onClick={() => void archive(file)}
                >
                  <Trash2 size={14} />
                </Button>
              </Allowed>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {files.loading ? "Loading files…" : "No files yet."}
        </p>
      )}
    </Section>
  );
}
