import { useState } from "react";
import { Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import type { RegeneratePreview } from "../../shared/planning";
import {
  planningStepStatusLabels,
  type PlanningProgress,
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
import { recipesApi } from "../services/core";
import { staffApi } from "../services/staff";
import { tasksApi } from "../services/tasks";
import { utcToBusinessTime } from "../../shared/time";
import { date, time } from "./event-format";
import "./event-preparation.css";

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

// The regenerate flow (FLOW-133 AC3): preview what would change, optionally discard
// manual edits, then confirm.
function RegenerateButton({
  label,
  preview,
  apply,
}: {
  label: string;
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
            <input
              type="checkbox"
              checked={discard}
              onChange={(e) => {
                setDiscard(e.target.checked);
                void load(e.target.checked);
              }}
            />{" "}
            Discard manual edits and removals
          </label>
          {!result ? (
            <p className="muted">Checking…</p>
          ) : result.upToDate ? (
            <p>Already up to date. Nothing would change.</p>
          ) : (
            <ul>
              {result.changes.map((change, index) => (
                <li key={index} data-kind={change.kind}>
                  <strong>{kinds[change.kind]}</strong> {change.label}
                  <small>
                    {change.current && ` now ${change.current}`}
                    {change.generated && ` → ${change.generated}`}
                    {change.kind === "kept" &&
                      ` (${change.reason === "removed" ? "removed" : "edited"} by hand, kept)`}
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
              Regenerate
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
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
      <Section title="Planning">
        <LoadError message={progress.error} />
      </Section>
    );
  if (!progress.data) return <LoadingSkeleton />;
  const data: PlanningProgress = progress.data;
  return (
    <Section
      title="Planning"
      action={
        data.canStart && (
          <Button onClick={() => setConfirm(true)}>Start planning</Button>
        )
      }
    >
      <ErrorLine message={error} />
      {!data.started ? (
        <p className="muted">
          Planning hasn't started. Starting moves the event to Preparation and builds the
          pull list and kitchen menu from the mapped proposal.
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
          {data.complete ? (
            <p>Planning is complete.</p>
          ) : (
            <Button variant="outline" onClick={() => void run(async () => progress.replace(await preparationApi.progress(event.id)))}>
              <RefreshCw size={14} />
              Refresh progress
            </Button>
          )}
        </>
      )}
      <ConfirmationDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Start planning?"
        onConfirm={async () => {
          progress.replace(await preparationApi.start(event.id));
          setConfirm(false);
          onStarted();
        }}
      >
        {event.title} will move to Preparation and its planning steps will run in the background.
      </ConfirmationDialog>
    </Section>
  );
}

// --- Pull list ------------------------------------------------------------------

export function EventPullListSection({ event }: { event: FlowEvent }) {
  const list = useResource(["event-pull-list", event.id], () => preparationApi.pullList(event.id));
  const staff = useResource(["staff"], () => staffApi.list());
  const { error, run } = useAction();
  const [draft, setDraft] = useState({ group: "kitchen_equipment" as PullGroup, name: "", quantity: "" });
  if (list.error)
    return (
      <Section title="Pull list">
        <LoadError message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  const data: PullList = list.data;
  const change = (action: () => Promise<PullList>) => run(async () => list.replace(await action()));
  const lines = data.groups.flatMap((group) => group.lines);
  return (
    <Section
      title="Pull list"
      action={
        <span className="page-actions">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={14} />
            Print
          </Button>
          {data.canEdit && (
            <RegenerateButton
              label="Regenerate pull list"
              preview={(discard) => preparationApi.previewPull(event.id, discard)}
              apply={(discard) => change(() => preparationApi.regeneratePull(event.id, discard))}
            />
          )}
        </span>
      }
    >
      <ErrorLine message={error} />
      {!data.exists && <p className="muted">No pull list yet. Start planning or add a line.</p>}
      {data.missingSchedule && (
        <p role="status" className="warning-message">
          Set when pulling starts and who pulls.
        </p>
      )}
      {data.tbdCount > 0 && (
        <p role="status" className="warning-message">
          {data.tbdCount} line{data.tbdCount === 1 ? " needs" : "s need"} a quantity.
        </p>
      )}
      {data.canEdit && (
        <div className="form-grid pull-schedule">
          <FormField label="Start pulling (date)">
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
          <FormField label="Start pulling (time)">
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
          <FormField label="Puller">
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
          Pulling starts {date(data.scheduledDate!)} at {time(data.scheduledTime)}
          {data.pullerName ? ` · ${data.pullerName}` : ""}
        </p>
      )}
      {data.groups.map((group) => (
        <div key={group.group} className="pull-group">
          <h3>{group.label}</h3>
          {group.lines.length === 0 ? (
            <p className="muted">Nothing to pull.</p>
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
                        {line.shortfall} short. {line.suggestions.map((s) => pullSuggestionLabels[s]).join(" · ")}
                      </small>
                    )}
                  </span>
                  {data.canEdit ? (
                    <input
                      className="pull-quantity"
                      aria-label={`Quantity of ${line.name}`}
                      inputMode="decimal"
                      placeholder="TBD"
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
                    <span className="pull-quantity">{line.quantity ?? "TBD"}</span>
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
            placeholder="Item"
            maxLength={200}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            aria-label="New line quantity"
            placeholder="Qty"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
          />
          <Button type="submit" variant="outline">
            <Plus size={14} />
            Add line
          </Button>
        </form>
      )}
      {lines.length > 0 && (
        <small className="muted">
          {lines.filter((line) => line.status !== "to_pull").length} of {lines.length} lines pulled or further along.
        </small>
      )}
    </Section>
  );
}

// --- Kitchen menu ---------------------------------------------------------------

export function EventKitchenMenuSection({ event }: { event: FlowEvent }) {
  const menu = useResource(["event-kitchen-menu", event.id], () => preparationApi.kitchenMenu(event.id));
  const dishes = useResource(["recipes", "active"], () => recipesApi.list());
  const staff = useResource(["staff"], () => staffApi.list());
  const { error, run } = useAction();
  const [draft, setDraft] = useState({ recipeId: "", course: "", quantity: "" });
  const [task, setTask] = useState({ title: "", assigneeId: "" });
  if (menu.error)
    return (
      <Section title="Kitchen menu">
        <LoadError message={menu.error} />
      </Section>
    );
  if (!menu.data) return <LoadingSkeleton />;
  const data: KitchenMenu = menu.data;
  const change = (action: () => Promise<KitchenMenu>) => run(async () => menu.replace(await action()));
  return (
    <Section
      title="Kitchen menu"
      action={
        <span className="page-actions">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={14} />
            Print
          </Button>
          {data.canEdit && (
            <RegenerateButton
              label="Regenerate kitchen menu"
              preview={(discard) => preparationApi.previewKitchen(event.id, discard)}
              apply={(discard) => change(() => preparationApi.regenerateKitchen(event.id, discard))}
            />
          )}
        </span>
      }
    >
      <ErrorLine message={error} />
      <p>
        {data.servings !== null ? `${data.servings} servings` : "Servings not set"}
        {data.venueArrivalAt && ` · Crew arrives ${time(utcToBusinessTime(new Date(data.venueArrivalAt)).time)}`}
      </p>
      {data.canEdit ? (
        <FormField label="Food leaves the kitchen">
          <input
            type="time"
            value={data.leavesKitchenTime ?? ""}
            onChange={(e) =>
              void change(() => preparationApi.setLeavesKitchen(event.id, e.target.value || null))
            }
          />
        </FormField>
      ) : (
        data.leavesKitchenTime && <p>Food leaves the kitchen at {time(data.leavesKitchenTime)}.</p>
      )}
      {!data.exists && <p className="muted">No kitchen menu yet. Start planning or add a dish.</p>}
      {data.courses.flatMap((course) => course.lines).some((line) => !line.scalable) && (
        <div role="status" className="planning-conflict warning">
          <strong>Dishes without a yield — excluded from ingredient requirements:</strong>{" "}
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
                  <strong>{line.name}</strong>
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
                    placeholder="TBD"
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
                  <span className="pull-quantity">{line.plannedQuantity ?? "TBD"}</span>
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
            placeholder="Course"
            maxLength={100}
            value={draft.course}
            onChange={(e) => setDraft({ ...draft, course: e.target.value })}
          />
          <input
            aria-label="New dish quantity"
            placeholder="Qty"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
          />
          <Button type="submit" variant="outline">
            <Plus size={14} />
            Add dish
          </Button>
        </form>
      )}
      <div className="kitchen-tasks">
        <h3>Kitchen tasks</h3>
        {data.tasks.length === 0 ? (
          <p className="muted">No kitchen tasks yet.</p>
        ) : (
          <ul>
            {data.tasks.map((t) => (
              <li key={t.id}>
                {t.title} <small>{t.assignees.map((a) => a.name).join(", ") || "Unassigned"}</small>
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
              placeholder="Prep task"
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
              Assign prep
            </Button>
          </form>
        )}
      </div>
    </Section>
  );
}
