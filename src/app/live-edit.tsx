import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, RotateCcw } from "lucide-react";
import { placeholderError, placeholderNames } from "../../shared/copy";
import { Button } from "../components/ui/button";
import { copyDefaults, layoutStyleProblems, pendingCount, pendingProblems, useLiveEdit, type EditorTarget } from "./copy";

// The admin's live text editing chrome (FLOW-240): the header pencil, Save and
// Cancel, the inline editor and the leave-page guard. Its own wording is not
// wrapped in <T>: in edit mode a click on it would open the editor instead of
// saving. The lint rule (FLOW-244) does not cover src/app.

// Header: the pencil for copy.edit; in edit mode, Save and Cancel instead.
export function LiveEditControls() {
  const live = useLiveEdit();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!live.canEdit) return null;
  if (!live.editing)
    return (
      <button
        type="button"
        className="live-edit-toggle"
        aria-label="Edit screen text"
        title="Edit screen text"
        onClick={() => live.setEditing(true)}
      >
        <Pencil size={17} />
      </button>
    );
  const count = pendingCount(live);
  const invalid = pendingProblems(live.pending).length > 0 || layoutStyleProblems(live.layoutPending).length > 0;
  return (
    <div className="live-edit-controls" role="group" aria-label="Editing screen text">
      {error && (
        <span role="alert" className="error-message">
          {error}
        </span>
      )}
      <Button
        disabled={!count || invalid || saving}
        onClick={async () => {
          setError("");
          setSaving(true);
          try {
            await live.save();
            live.setEditing(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setError("");
          live.cancel();
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

// The editor, the input-placeholder click handler and the navigation guard.
export function LiveEditLayer() {
  const live = useLiveEdit();
  const { editing, open } = live;
  // Inputs with a useCopy placeholder: a click edits the placeholder. The body
  // class outlines them, drawers included.
  useEffect(() => {
    if (!editing) return;
    document.body.classList.add("live-editing");
    const click = (event: globalThis.MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest?.(
        "input[data-copy-id], textarea[data-copy-id]",
      ) as HTMLElement | null;
      if (!element) return;
      const id = element.dataset.copyId ?? "";
      const defaultText = copyDefaults.get(id);
      if (defaultText === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      open({ id, defaultText, placeholders: placeholderNames(defaultText), anchor: element });
    };
    document.addEventListener("click", click, true);
    return () => {
      document.body.classList.remove("live-editing");
      document.removeEventListener("click", click, true);
    };
  }, [editing, open]);
  return (
    <>
      {live.editing && live.target && <CopyEditor key={live.target.id} target={live.target} />}
      {/* Mounted only in edit mode: useBlocker needs the app's data router. */}
      {live.editing && <LeaveGuard />}
    </>
  );
}

function CopyEditor({ target }: { target: EditorTarget }) {
  const live = useLiveEdit();
  const pending = live.pending[target.id];
  const saved = live.overrides[target.id];
  const initial = pending ? (pending.text ?? target.defaultText) : (saved ?? target.defaultText);
  const [draft, setDraft] = useState(initial);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const rect = target.anchor.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 220),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [target.anchor]);
  useEffect(() => field.current?.focus(), []);
  const error = placeholderError(target.placeholders, draft);
  const resettable = saved !== undefined || (pending?.text ?? null) !== null;
  const update = (text: string) => {
    setDraft(text);
    live.stage(target.id, text, target.defaultText, target.placeholders);
  };
  // Inside a modal drawer the editor must sit in the drawer, or it can't take focus.
  const host = (target.anchor.closest("[role='dialog']") as HTMLElement | null) ?? document.body;
  return createPortal(
    <div
      className="live-copy-editor"
      role="dialog"
      aria-label="Edit text"
      style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") live.close();
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={field}
        aria-label="Text"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "live-copy-error" : undefined}
        value={draft}
        maxLength={500}
        rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 40)))}
        onChange={(event) => update(event.target.value)}
      />
      {error && (
        <p id="live-copy-error" className="live-copy-error" role="alert">
          {error}
        </p>
      )}
      {!draft.trim() && <p className="live-copy-error" role="alert">The text can't be empty</p>}
      <div className="live-copy-editor-actions">
        <small>{target.id}</small>
        {resettable && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(target.defaultText);
              live.stage(target.id, null, target.defaultText, target.placeholders);
            }}
          >
            <RotateCcw size={14} />
            Reset to default
          </Button>
        )}
        <Button variant="outline" onClick={() => live.close()}>
          Done
        </Button>
      </div>
    </div>,
    host,
  );
}

// Leaving a page (or the app) with unsaved edits: Save, Discard or Stay.
function LeaveGuard() {
  const live = useLiveEdit();
  const dirty = pendingCount(live) > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const blocked = blocker.state === "blocked";
  const invalid = pendingProblems(live.pending).length > 0 || layoutStyleProblems(live.layoutPending).length > 0;
  return (
    <Dialog.Root open={blocked} onOpenChange={(open) => !open && blocked && blocker.reset()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="live-edit-leave" aria-describedby="live-edit-leave-text">
          <Dialog.Title>Save your text changes?</Dialog.Title>
          <p id="live-edit-leave-text">
            You have unsaved text changes on this page. Save them before you leave, or discard them.
          </p>
          {invalid && <p className="live-copy-error">Fix the highlighted placeholder or color before saving.</p>}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              disabled={invalid}
              onClick={async () => {
                setError("");
                try {
                  await live.save();
                  if (blocker.state === "blocked") blocker.proceed();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // Discard drops the edits; edit mode stays on for the next page.
                live.cancel();
                live.setEditing(true);
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              Discard
            </Button>
            <Button variant="ghost" onClick={() => blocker.state === "blocked" && blocker.reset()}>
              Stay
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
