import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import type { RegeneratePreview } from "../../shared/planning";
import type { PlanningProgress } from "../../shared/planning";
import {
  planningStepStatusLabels,
} from "../../shared/planning";
import {
  pullGroups,
  pullGroupLabels,
  pullStatuses,
  pullStatusLabels,
  pullSuggestionLabels,
  type PullGroup,
  type PullList,
  type PullStatus,
} from "../../shared/pull-list";
import type { KitchenMenu } from "../../shared/kitchen-menu";
import { useResource } from "../app/useResource";
import { Button, ConfirmationDialog, FormField, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { preparationApi } from "../services/preparation";
import { recipesApi, sectionsApi } from "../services/core";
import { staffApi } from "../services/staff";
import { tasksApi } from "../services/tasks";
import { utcToBusinessTime } from "../../shared/time";
import { date, time } from "./event-format";
import "./event-preparation.css";
import { RoundCheck } from "../components/ui/round-check";
import { Plural, T, useCopy } from "../app/copy";

// Start planning, the pull list and the kitchen menu (FLOW-133/134/137).

const useAction = () => {
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { error, run };
};
const ErrorLine = ({ message }: { message: string }) =>
  message ? (
    <p role="alert" className="error-message">
      {message}
    </p>
  ) : null;

function RefreshPlanningOutput({ eventId, output, onChanged }: {
  eventId: string;
  output: PlanningProgress["staleOutputs"][number];
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<RegeneratePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (output.kind === "pull_list" || output.kind === "kitchen_menu") return null;
  const kind = output.kind;
  return <div className="regen-preview">
    <Button variant="outline" disabled={busy} onClick={async () => {
      setError(""); setBusy(true);
      try { setPreview(await preparationApi.previewPlanningOutput(eventId, kind)); }
      catch (cause) { setError((cause as Error).message); }
      finally { setBusy(false); }
    }}><T id="event-preparation.refresh-planning-output.preview-regeneration" values={{ replaceAll: kind.replaceAll("_", " ") }}>{"Preview {replaceAll} regeneration"}</T></Button>
    <ErrorLine message={error} />
    {preview && <div role="region" aria-label={`${kind} regeneration preview`}>
      {preview.upToDate ? <p><T id="event-preparation.refresh-planning-output.no-derived-values-changed-manual">No derived values changed. Manual entries will be kept.</T></p> : <ul>
        {preview.changes.map((change, index) => <li key={`${change.label}:${index}`}>
          {change.label}: {change.current ?? "—"} → {change.generated ?? "—"}
        </li>)}
      </ul>}
      <Button disabled={busy} onClick={async () => {
        setError(""); setBusy(true);
        try {
          await preparationApi.regeneratePlanningOutput(eventId, kind, output.staleAt);
          setPreview(null); onChanged();
        } catch (cause) { setError((cause as Error).message); }
        finally { setBusy(false); }
      }}><T id="event-preparation.refresh-planning-output.regenerate">Regenerate</T></Button>
      <Button variant="outline" onClick={() => setPreview(null)}><T id="event-preparation.refresh-planning-output.cancel">Cancel</T></Button>
    </div>}
  </div>;
}

// The regenerate flow (FLOW-133 AC3): preview what would change, optionally discard
// manual edits, then confirm.
function RegenerateButton({
  label,
  preview,
  apply,
}: {
  label: ReactNode;
  preview: (discardEdits: boolean) => Promise<RegeneratePreview>;
  apply: (discardEdits: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [result, setResult] = useState<RegeneratePreview | null>(null);
  const [error, setError] = useState("");
  const load = async (discardEdits: boolean) => {
    setError("");
    try {
      setResult(await preview(discardEdits));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const kinds = { added: "Add", changed: "Change", removed: "Remove", kept: "Keep" } as const;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setDiscard(false);
          setResult(null);
          setOpen(true);
          void load(false);
        }}
      >
        <RefreshCw size={14} />
        {label}
      </Button>
      {open && (
        <div className="regen-preview" role="region" aria-label="Regeneration preview">
          <strong>{label}</strong>
          <ErrorLine message={error} />
          <label>
            <RoundCheck
              checked={discard}
              onChange={(e) => {
                setDiscard(e.target.checked);
                void load(e.target.checked);
              }}
            /><T id="event-preparation.regenerate-button.discard-manual-edits-and-removals">{" Discard manual edits and removals"}</T>
          </label>
          {!result ? (
            <p className="muted"><T id="event-preparation.regenerate-button.checking">Checking…</T></p>
          ) : result.upToDate ? (
            <p><T id="event-preparation.regenerate-button.already-up-to-date-nothing">Already up to date. Nothing would change.</T></p>
          ) : (
            <ul>
              {result.changes.map((change, index) => (
                <li key={index} data-kind={change.kind}>
                  <strong>{kinds[change.kind]}</strong> {change.label}
                  <small>
                    {change.current && <T id="event-preparation.regenerate-button.now" values={{ current: change.current }}>{" now {current}"}</T>}
                    {change.generated && ` → ${change.generated}`}
                    {change.kind === "kept" &&
                      (change.reason === "removed"
                        ? <T id="event-preparation.regenerate-button.removed-by-hand-kept">{" (removed by hand, kept)"}</T>
                        : <T id="event-preparation.regenerate-button.edited-by-hand-kept">{" (edited by hand, kept)"}</T>)}
                  </small>
                </li>
              ))}
            </ul>
          )}
          <span className="page-actions">
            <Button
              disabled={!result || result.upToDate}
              onClick={async () => {
                try {
                  await apply(discard);
                  setOpen(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <T id="event-preparation.regenerate-button.regenerate">Regenerate</T>
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              <T id="event-preparation.regenerate-button.cancel">Cancel</T>
            </Button>
          </span>
        </div>
      )}
    </>
  );
}

// --- Planning -------------------------------------------------------------------

export function EventPlanningProgressSection({
  event,
  onStarted,
}: {
  event: FlowEvent;
  onStarted: () => void;
}) {
  const progress = useResource(["event-planning-progress", event.id], () =>
    preparationApi.progress(event.id),
  );
  const { error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  if (progress.error)
    return (
      <Section title={<T id="event-preparation.event-planning-progress-section.planning">Planning</T>}>
        <LoadError message={progress.error} />
      </Section>
    );
  if (!progress.data) return <LoadingSkeleton />;
  const data: PlanningProgress = progress.data;
  return (
    <Section
      title={<T id="event-preparation.event-planning-progress-section.planning">Planning</T>}
      action={
        data.canStart && (
          <Button onClick={() => setConfirm(true)}><T id="event-preparation.event-planning-progress-section.start-planning">Start planning</T></Button>
        )
      }
    >
      <ErrorLine message={error} />
      {!data.started ? (
        <p className="muted">
          <T id="event-preparation.event-planning-progress-section.planning-hasn-t-started-starting">{"Planning hasn't started. Starting moves the event to Preparation and builds the pull list and kitchen menu from the mapped proposal."}</T>
        </p>
      ) : (
        <>
          <ul className="planning-steps">
            {data.steps.map((step) => (
              <li key={step.step} data-status={step.status}>
                <span>{step.label}</span>
                <span className="badge neutral">{planningStepStatusLabels[step.status]}</span>
                {step.detail && <small>{step.detail}</small>}
              </li>
            ))}
          </ul>
          {data.staleOutputs.length > 0 && <div role="status" className="warning-message">
            <strong><T id="event-preparation.event-planning-progress-section.planning-outputs-need-review">Planning outputs need review</T></strong>
            <ul>{data.staleOutputs.map((output) => <li key={output.kind}>
              {output.kind.replaceAll("_", " ")}: {output.cause}.
              {(output.kind === "pull_list" || output.kind === "kitchen_menu") && <T id="event-preparation.event-planning-progress-section.use-the-regenerate-button-in">{" Use the Regenerate button in that section to preview the diff and keep manual edits."}</T>}
            </li>)}</ul>
            {data.canRegenerate && data.staleOutputs.map((output) => <RefreshPlanningOutput
              key={output.kind} eventId={event.id} output={output} onChanged={progress.reload} />)}
          </div>}
          {data.complete ? (
            <p><T id="event-preparation.event-planning-progress-section.planning-is-complete">Planning is complete.</T></p>
          ) : (
            <Button variant="outline" onClick={() => void run(async () => progress.replace(await preparationApi.progress(event.id)))}>
              <RefreshCw size={14} />
              <T id="event-preparation.event-planning-progress-section.refresh-progress">Refresh progress</T>
            </Button>
          )}
        </>
      )}
      <ConfirmationDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={<T id="event-preparation.event-planning-progress-section.start-planning-2">Start planning?</T>}
        onConfirm={async () => {
          progress.replace(await preparationApi.start(event.id));
          setConfirm(false);
          onStarted();
        }}
      >
        <T id="event-preparation.event-planning-progress-section.will-move-to-preparation-and" values={{ title: event.title }}>{"{title} will move to Preparation and its planning steps will run in the background."}</T>
      </ConfirmationDialog>
    </Section>
  );
}

// --- Pull list ------------------------------------------------------------------

export function EventPullListSection({ event }: { event: FlowEvent }) {
  const tbdPlaceholder = useCopy("event-preparation.event-pull-list-section.tbd.placeholder", "TBD");
  const itemPlaceholder = useCopy("event-preparation.event-pull-list-section.item.placeholder", "Item");
  const qtyPlaceholder = useCopy("event-preparation.event-pull-list-section.qty.placeholder", "Qty");
  const list = useResource(["event-pull-list", event.id], () => preparationApi.pullList(event.id));
  const sections = useResource(["inventory-sections"], () => sectionsApi.list());
  const staff = useResource(["staff"], () => staffApi.list());
  const { error, run } = useAction();
  const [draft, setDraft] = useState({ group: "kitchen_equipment" as PullGroup, name: "", quantity: "" });
  if (list.error)
    return (
      <Section title={<T id="event-preparation.event-pull-list-section.pull-list">Pull list</T>}>
        <LoadError message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  const data: PullList = list.data;
  const change = (action: () => Promise<PullList>) => run(async () => list.replace(await action()));
  const lines = data.groups.flatMap((group) => group.lines);
  return (
    <Section
      title={<T id="event-preparation.event-pull-list-section.pull-list">Pull list</T>}
      action={
        <span className="page-actions">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={14} />
            <T id="event-preparation.event-pull-list-section.print">Print</T>
          </Button>
          {data.canEdit && (
            <RegenerateButton
              label={<T id="event-preparation.event-pull-list-section.regenerate-pull-list">Regenerate pull list</T>}
              preview={(discard) => preparationApi.previewPull(event.id, discard)}
              apply={(discard) => change(() => preparationApi.regeneratePull(event.id, discard))}
            />
          )}
        </span>
      }
    >
      <ErrorLine message={error} />
      {!data.exists && <p className="muted"><T id="event-preparation.event-pull-list-section.no-pull-list-yet-start">No pull list yet. Start planning or add a line.</T></p>}
      {data.missingSchedule && (
        <p role="status" className="warning-message">
          <T id="event-preparation.event-pull-list-section.readiness-check-missing-schedule-set">Readiness check: Missing schedule — set the pull date, time and puller.</T>
        </p>
      )}
      {data.tbdCount > 0 && (
        <p role="status" className="warning-message">
          <Plural id="event-preparation.event-pull-list-section.lines-need-a-quantity" count={data.tbdCount} one="{count} line needs a quantity." other="{count} lines need a quantity." />
        </p>
      )}
      {data.canEdit && (
        <div className="form-grid pull-schedule">
          <FormField label={<T id="event-preparation.event-pull-list-section.start-pulling-date">Start pulling (date)</T>}>
            <input
              type="date"
              value={data.scheduledDate ?? ""}
              onChange={(e) =>
                void change(() =>
                  preparationApi.schedulePull(event.id, {
                    date: e.target.value || null,
                    time: e.target.value ? (data.scheduledTime ?? "09:00") : null,
                    pullerId: data.pullerId,
                  }),
                )
              }
            />
          </FormField>
          <FormField label={<T id="event-preparation.event-pull-list-section.start-pulling-time">Start pulling (time)</T>}>
            <input
              type="time"
              value={data.scheduledTime ?? ""}
              onChange={(e) =>
                void change(() =>
                  preparationApi.schedulePull(event.id, {
                    date: e.target.value ? (data.scheduledDate ?? event.date) : null,
                    time: e.target.value || null,
                    pullerId: data.pullerId,
                  }),
                )
              }
            />
          </FormField>
          <FormField label={<T id="event-preparation.event-pull-list-section.puller">Puller</T>}>
            <select
              value={data.pullerId ?? ""}
              onChange={(e) =>
                void change(() =>
                  preparationApi.schedulePull(event.id, {
                    date: data.scheduledDate,
                    time: data.scheduledTime,
                    pullerId: e.target.value || null,
                  }),
                )
              }
            >
              <option value="">Nobody</option>
              {(staff.data ?? [])
                .filter((member) => member.active || member.id === data.pullerId)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </FormField>
        </div>
      )}
      {!data.canEdit && data.scheduledAt && (
        <p>
          <T id="event-preparation.event-pull-list-section.pulling-starts-at" values={{ date: date(data.scheduledDate!), scheduledTime: time(data.scheduledTime), value: data.pullerName ? ` · ${data.pullerName}` : "" }}>{"Pulling starts {date} at {scheduledTime}{value}"}</T>
        </p>
      )}
      {data.groups.map((group) => (
        <div key={group.group} className="pull-group">
          <h3>{group.label}</h3>
          {group.lines.length === 0 ? (
            <p className="muted"><T id="event-preparation.event-pull-list-section.nothing-to-pull">Nothing to pull.</T></p>
          ) : (
            <ul className="pull-lines">
              {group.lines.map((line) => (
                <li key={line.id} data-status={line.status} data-tbd={line.tbd || undefined}>
                  <span className="pull-name">
                    <strong>{line.name}</strong>
                    <small>
                      {[
                        line.sectionName,
                        line.setupDay ? "Setup day" : null,
                        line.notes,
                        line.statusBy && line.statusAt
                          ? `${pullStatusLabels[line.status]} by ${line.statusBy}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    {line.shortfall !== null && (
                      <small className="warning-message">
                        <T id="event-preparation.event-pull-list-section.short" values={{ shortfall: line.shortfall }}>{"{shortfall} short. "}</T>{line.suggestions.map((s) => pullSuggestionLabels[s]).join(" · ")}
                      </small>
                    )}
                  </span>
                  {data.canEdit ? (
                    <input
                      className="pull-quantity"
                      aria-label={`Quantity of ${line.name}`}
                      inputMode="decimal"
                      placeholder={tbdPlaceholder} data-copy-id="event-preparation.event-pull-list-section.tbd.placeholder"
                      defaultValue={line.quantity ?? ""}
                      onBlur={(e) => {
                        const text = e.target.value.trim();
                        const next = text === "" ? null : Number(text);
                        if (next !== null && !Number.isFinite(next)) return;
                        if (next !== line.quantity)
                          void change(() =>
                            preparationApi.updatePullLine(event.id, line.id, { quantity: next }),
                          );
                      }}
                    />
                  ) : (
                    <span className="pull-quantity">{line.quantity ?? <T id="event-preparation.event-pull-list-section.tbd">TBD</T>}</span>
                  )}
                  {data.canEdit && (
                    <select
                      aria-label={`Section of ${line.name}`}
                      value={line.sectionId ?? ""}
                      onChange={(e) => void change(() => preparationApi.updatePullLine(
                        event.id, line.id, { sectionId: e.target.value || null },
                      ))}
                    >
                      <option value="">No section</option>
                      {(sections.data ?? []).filter((section) => !section.archivedAt || section.id === line.sectionId)
                        .map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                  )}
                  <select
                    aria-label={`Status of ${line.name}`}
                    value={line.status}
                    onChange={(e) =>
                      void change(() =>
                        preparationApi.setPullStatus(event.id, line.id, e.target.value as PullStatus),
                      )
                    }
                  >
                    {pullStatuses.map((status) => (
                      <option key={status} value={status}>
                        {pullStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                  {data.canEdit && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => void change(() => preparationApi.removePullLine(event.id, line.id))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {data.canEdit && (
        <form
          className="pull-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            const quantity = draft.quantity.trim() === "" ? null : Number(draft.quantity);
            void change(async () => {
              const next = await preparationApi.addPullLine(event.id, {
                group: draft.group,
                name: draft.name.trim(),
                quantity: quantity !== null && Number.isFinite(quantity) ? quantity : null,
              });
              setDraft({ group: draft.group, name: "", quantity: "" });
              return next;
            });
          }}
        >
          <select
            aria-label="New line group"
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value as PullGroup })}
          >
            {pullGroups.map((group) => (
              <option key={group} value={group}>
                {pullGroupLabels[group]}
              </option>
            ))}
          </select>
          <input
            aria-label="New line name"
            placeholder={itemPlaceholder} data-copy-id="event-preparation.event-pull-list-section.item.placeholder"
            maxLength={200}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            aria-label="New line quantity"
            placeholder={qtyPlaceholder} data-copy-id="event-preparation.event-pull-list-section.qty.placeholder"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
          />
          <Button type="submit" variant="outline">
            <Plus size={14} />
            <T id="event-preparation.event-pull-list-section.add-line">Add line</T>
          </Button>
        </form>
      )}
      {lines.length > 0 && (
        <small className="muted">
          {lines.filter((line) => line.status !== "to_pull").length}<T id="event-preparation.event-pull-list-section.of-lines-pulled-or-further" values={{ linesCount: lines.length }}>{" of {linesCount} lines pulled or further along."}</T>
        </small>
      )}
    </Section>
  );
}

// --- Kitchen menu ---------------------------------------------------------------

export function EventKitchenMenuSection({ event }: { event: FlowEvent }) {
  const tbdPlaceholder = useCopy("event-preparation.event-kitchen-menu-section.tbd.placeholder", "TBD");
  const coursePlaceholder = useCopy("event-preparation.event-kitchen-menu-section.course.placeholder", "Course");
  const qtyPlaceholder = useCopy("event-preparation.event-kitchen-menu-section.qty.placeholder", "Qty");
  const prepTaskPlaceholder = useCopy("event-preparation.event-kitchen-menu-section.prep-task.placeholder", "Prep task");
  const menu = useResource(["event-kitchen-menu", event.id], () => preparationApi.kitchenMenu(event.id));
  const dishes = useResource(["recipes", "active"], () => recipesApi.list());
  const staff = useResource(["staff"], () => staffApi.list());
  const { error, run } = useAction();
  const [draft, setDraft] = useState({ recipeId: "", course: "", quantity: "" });
  const [task, setTask] = useState({ title: "", assigneeId: "" });
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("printing-kitchen-sheet");
    const clear = () => { document.body.classList.remove("printing-kitchen-sheet"); setPrinting(false); };
    window.addEventListener("afterprint", clear, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); window.removeEventListener("afterprint", clear); document.body.classList.remove("printing-kitchen-sheet"); };
  }, [printing]);
  if (menu.error)
    return (
      <Section title={<T id="event-preparation.event-kitchen-menu-section.kitchen-menu">Kitchen menu</T>}>
        <LoadError message={menu.error} />
      </Section>
    );
  if (!menu.data) return <LoadingSkeleton />;
  const data: KitchenMenu = menu.data;
  const change = (action: () => Promise<KitchenMenu>) => run(async () => menu.replace(await action()));
  return (
    <Section
      title={<T id="event-preparation.event-kitchen-menu-section.kitchen-menu">Kitchen menu</T>}
      action={
        <span className="page-actions">
          <Button variant="outline" onClick={() => setPrinting(true)}>
            <Printer size={14} />
            <T id="event-preparation.event-kitchen-menu-section.print">Print</T>
          </Button>
          {data.canEdit && (
            <RegenerateButton
              label={<T id="event-preparation.event-kitchen-menu-section.regenerate-kitchen-menu">Regenerate kitchen menu</T>}
              preview={(discard) => preparationApi.previewKitchen(event.id, discard)}
              apply={(discard) => change(() => preparationApi.regenerateKitchen(event.id, discard))}
            />
          )}
        </span>
      }
    >
      <ErrorLine message={error} />
      <article className="kitchen-print-sheet" aria-label="Kitchen sheet">
        <h2><T id="event-preparation.event-kitchen-menu-section.kitchen-sheet" values={{ title: event.title }}>{"{title} — kitchen sheet"}</T></h2>
        <p>{date(event.date)} · {data.servings === null ? <T id="event-preparation.event-kitchen-menu-section.servings-tbd">Servings TBD</T> : <T id="event-preparation.event-kitchen-menu-section.servings" values={{ servings: data.servings }}>{"{servings} servings"}</T>}</p>
        <p><T id="event-preparation.event-kitchen-menu-section.food-leaves-kitchen">{"Food leaves kitchen: "}</T>{data.leavesKitchenTime ? time(data.leavesKitchenTime) : <T id="event-preparation.event-kitchen-menu-section.tbd">TBD</T>}</p>
        <p><T id="event-preparation.event-kitchen-menu-section.venue-arrival">{"Venue arrival: "}</T>{data.venueArrivalAt ? time(utcToBusinessTime(new Date(data.venueArrivalAt)).time) : <T id="event-preparation.event-kitchen-menu-section.tbd">TBD</T>}</p>
        {data.courses.map((course) => <section key={course.course}>
          <h3>{course.course}</h3>
          <ul>{course.lines.map((line) => <li key={line.id}>
            <strong>{line.name}</strong> — {line.plannedQuantity ?? <T id="event-preparation.event-kitchen-menu-section.tbd">TBD</T>}
            {line.notes && ` · ${line.notes}`}
            {line.allergens.length > 0 && <T id="event-preparation.event-kitchen-menu-section.allergens" values={{ join: line.allergens.join(", ") }}>{" · Allergens: {join}"}</T>}
          </li>)}</ul>
        </section>)}
        <h3><T id="event-preparation.event-kitchen-menu-section.prep-assignments">Prep assignments</T></h3>
        <ul>{data.tasks.map((task) => <li key={task.id}>{task.title} — {task.assignees.map((person) => person.name).join(", ") || <T id="event-preparation.event-kitchen-menu-section.unassigned">Unassigned</T>}</li>)}</ul>
      </article>
      <p>
        {data.servings !== null ? <T id="event-preparation.event-kitchen-menu-section.servings" values={{ servings: data.servings }}>{"{servings} servings"}</T> : <T id="event-preparation.event-kitchen-menu-section.servings-not-set">Servings not set</T>}
        {data.venueArrivalAt && <T id="event-preparation.event-kitchen-menu-section.crew-arrives" values={{ time: time(utcToBusinessTime(new Date(data.venueArrivalAt)).time) }}>{" · Crew arrives {time}"}</T>}
      </p>
      {data.canEdit ? (
        <FormField label={<T id="event-preparation.event-kitchen-menu-section.food-leaves-the-kitchen">Food leaves the kitchen</T>}>
          <input
            type="time"
            value={data.leavesKitchenTime ?? ""}
            onChange={(e) =>
              void change(() => preparationApi.setLeavesKitchen(event.id, e.target.value || null))
            }
          />
        </FormField>
      ) : (
        data.leavesKitchenTime && <p><T id="event-preparation.event-kitchen-menu-section.food-leaves-the-kitchen-at" values={{ leavesKitchenTime: time(data.leavesKitchenTime) }}>{"Food leaves the kitchen at {leavesKitchenTime}."}</T></p>
      )}
      {!data.exists && <p className="muted"><T id="event-preparation.event-kitchen-menu-section.no-kitchen-menu-yet-start">No kitchen menu yet. Start planning or add a dish.</T></p>}
      {data.courses.flatMap((course) => course.lines).some((line) => !line.scalable) && (
        <div role="status" className="planning-conflict warning">
          <strong><T id="event-preparation.event-kitchen-menu-section.dishes-without-a-yield-excluded">Dishes without a yield — excluded from ingredient requirements:</T></strong>{" "}
          {data.courses.flatMap((course) => course.lines).filter((line) => !line.scalable)
            .map((line) => line.name).join(", ")}
        </div>
      )}
      {data.courses.map((course) => (
        <div key={course.course} className="kitchen-course">
          <h3>{course.course}</h3>
          <ul className="kitchen-lines">
            {course.lines.map((line) => (
              <li key={line.id} data-tbd={line.tbd || undefined}>
                <span className="pull-name">
                  <strong><Link to={`/recipes/${line.recipeId}`}>{line.name}</Link></strong>
                  {line.plannedQuantity !== null && line.scalable && (
                    <small><Link to={`/recipes/${line.recipeId}?servings=${line.plannedQuantity}#scale`}><T id="event-preparation.event-kitchen-menu-section.method-and-ingredients-for-servings" values={{ plannedQuantity: line.plannedQuantity }}>{"Method and ingredients for {plannedQuantity} servings"}</T></Link></small>
                  )}
                  <small>
                    {[
                      line.dietaryTags.join(", "),
                      line.allergens.length ? `Allergens: ${line.allergens.join(", ")}` : null,
                      line.notes,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {data.canEdit ? (
                  <input
                    className="pull-quantity"
                    aria-label={`Planned quantity of ${line.name}`}
                    inputMode="decimal"
                    placeholder={tbdPlaceholder} data-copy-id="event-preparation.event-kitchen-menu-section.tbd.placeholder"
                    defaultValue={line.plannedQuantity ?? ""}
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      const next = text === "" ? null : Number(text);
                      if (next !== null && !Number.isFinite(next)) return;
                      if (next !== line.plannedQuantity)
                        void change(() =>
                          preparationApi.updateKitchenLine(event.id, line.id, { plannedQuantity: next }),
                        );
                    }}
                  />
                ) : (
                  <span className="pull-quantity">{line.plannedQuantity ?? <T id="event-preparation.event-kitchen-menu-section.tbd">TBD</T>}</span>
                )}
                {data.canEdit && (
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => void change(() => preparationApi.removeKitchenLine(event.id, line.id))}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data.canEdit && (
        <form
          className="pull-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.recipeId) return;
            const quantity = draft.quantity.trim() === "" ? null : Number(draft.quantity);
            void change(async () => {
              const next = await preparationApi.addKitchenLine(event.id, {
                recipeId: draft.recipeId,
                course: draft.course,
                plannedQuantity: quantity !== null && Number.isFinite(quantity) ? quantity : data.servings,
              });
              setDraft({ recipeId: "", course: draft.course, quantity: "" });
              return next;
            });
          }}
        >
          <select
            aria-label="New dish"
            value={draft.recipeId}
            onChange={(e) => setDraft({ ...draft, recipeId: e.target.value })}
          >
            <option value="">Choose a dish</option>
            {(dishes.data ?? []).map((dish) => (
              <option key={dish.id} value={dish.id}>
                {dish.name}
              </option>
            ))}
          </select>
          <input
            aria-label="New dish course"
            placeholder={coursePlaceholder} data-copy-id="event-preparation.event-kitchen-menu-section.course.placeholder"
            maxLength={100}
            value={draft.course}
            onChange={(e) => setDraft({ ...draft, course: e.target.value })}
          />
          <input
            aria-label="New dish quantity"
            placeholder={qtyPlaceholder} data-copy-id="event-preparation.event-kitchen-menu-section.qty.placeholder"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
          />
          <Button type="submit" variant="outline">
            <Plus size={14} />
            <T id="event-preparation.event-kitchen-menu-section.add-dish">Add dish</T>
          </Button>
        </form>
      )}
      <div className="kitchen-tasks">
        <h3><T id="event-preparation.event-kitchen-menu-section.kitchen-tasks">Kitchen tasks</T></h3>
        {data.tasks.length === 0 ? (
          <p className="muted"><T id="event-preparation.event-kitchen-menu-section.no-kitchen-tasks-yet">No kitchen tasks yet.</T></p>
        ) : (
          <ul>
            {data.tasks.map((t) => (
              <li key={t.id}>
                {t.title} <small>{t.assignees.map((a) => a.name).join(", ") || <T id="event-preparation.event-kitchen-menu-section.unassigned">Unassigned</T>}</small>
              </li>
            ))}
          </ul>
        )}
        {data.canAssign && (
          <form
            className="pull-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!task.title.trim()) return;
              void run(async () => {
                await tasksApi.create({
                  title: task.title.trim(),
                  type: "kitchen",
                  eventId: event.id,
                  assigneeIds: task.assigneeId ? [task.assigneeId] : [],
                });
                setTask({ title: "", assigneeId: "" });
                menu.replace(await preparationApi.kitchenMenu(event.id));
              });
            }}
          >
            <input
              aria-label="Kitchen task title"
              placeholder={prepTaskPlaceholder} data-copy-id="event-preparation.event-kitchen-menu-section.prep-task.placeholder"
              maxLength={200}
              value={task.title}
              onChange={(e) => setTask({ ...task, title: e.target.value })}
            />
            <select
              aria-label="Kitchen task assignee"
              value={task.assigneeId}
              onChange={(e) => setTask({ ...task, assigneeId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {(staff.data ?? [])
                .filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
            <Button type="submit" variant="outline">
              <Plus size={14} />
              <T id="event-preparation.event-kitchen-menu-section.assign-prep">Assign prep</T>
            </Button>
          </form>
        )}
      </div>
    </Section>
  );
}
