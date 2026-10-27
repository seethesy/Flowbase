import { Allowed } from "../app/permissions";
import { attachmentWriteActions } from "../../shared/policy";
import { useRef, useState, type MouseEvent } from "react";
import { FileText, Upload, Trash2 } from "lucide-react";
import type {
  Attachment,
  AttachmentRecordType,
} from "../../shared/attachments";
import { attachmentsApi, uploadAttachment } from "../services/attachments";
import { useResource } from "../app/useResource";
import { Button, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import "./attachments.css";

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,application/pdf,.docx";

// Signed links last five minutes (FLOW-42). Treat one as expired slightly
// early, so it can't lapse between the click and the download starting.
const EXPIRY_MARGIN_MS = 10_000;
const expired = (file: Attachment) =>
  Boolean(file.urlsExpireAt) &&
  Date.parse(file.urlsExpireAt!) - EXPIRY_MARGIN_MS <= Date.now();

// Photos and documents attached to a record (FLOW-42). Signed links expire after
// a few minutes, so the list reloads them on every visit and renews them while
// the record stays open (FLOW-201). Every group on a record shares one list
// request, so the groups renew together.
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
    ["attachments", recordType, recordId],
    () => attachmentsApi.list(recordType, recordId),
    {
      // The earliest link to expire decides when the list is renewed.
      expiresAt: (list) =>
        list
          .map((file) => file.urlsExpireAt)
          .filter((at): at is string => Boolean(at))
          .sort()[0],
    },
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
  // A link that expired while the page stayed open (e.g. the computer slept
  // through the renewal) is never opened: fetch fresh links first. The tab is
  // opened during the click so the browser doesn't block it as a pop-up, then
  // sent to the fresh link, or closed if renewal fails.
  const open = async (
    event: MouseEvent<HTMLAnchorElement>,
    file: Attachment,
    variant: "display" | "original",
  ) => {
    if (!expired(file)) return;
    event.preventDefault();
    setError("");
    const tab = window.open("", "_blank");
    try {
      const fresh = (await files.refresh())?.find(
        (candidate) => candidate.id === file.id,
      );
      const url = fresh && !expired(fresh) ? fresh.urls[variant] : undefined;
      if (!url) throw new Error("This file is no longer available.");
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
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
                <a
                  href={file.urls.display}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => void open(e, file, "display")}
                >
                  <img src={file.urls.thumb} alt={file.caption || file.fileName} />
                </a>
              ) : (
                <a
                  href={file.urls.original}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => void open(e, file, "original")}
                >
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
