import { Dropdown } from "../../components/ui/Dropdown";
import { useState, type FormEvent } from "react";
import { taskPriorities, taskPriorityLabels, taskTypeLabels, taskTypes, type TaskPriority, type TaskType } from "../../../shared/tasks";
import { businessTimeToUtc, isBusinessTime } from "../../../shared/time";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { Button, DetailDrawer, FormField, ErrorText } from "../../components/shared";
import { eventsApi } from "../../services/core";
import { staffApi } from "../../services/staff";
import { tasksApi } from "../../services/tasks";
import { useBusinessSettings } from "../../services/settings";
import { sopsApi } from "../../services/sops";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";
import "./tasks.css";

// The new-task form (FLOW-59), and the staff and upcoming-event pickers it shares
// with the task lists.

export const names = (people: { name: string }[]) =>
  people.map((person) => person.name).join(", ") || "Unassigned";

// Active staff, for assignee and manager pickers.
export function useActiveStaff(enabled = true) {
  const staff = useResource(["staff"], () => staffApi.list(), { reference: true, enabled });
  return (staff.data ?? []).filter((member) => member.active);
}

// Upcoming events, for the event filter and the new-task form.
export function useUpcomingEvents() {
  const events = useResource(
    ["tasks", "event-options"],
    async () => (await eventsApi.list({})).rows,
    { reference: true },
  );
  return events.data ?? [];
}

// The new-task form. Managers start with the configured defaults and may be edited
// by someone who may delegate.
export function NewTaskDrawer({
  open,
  onClose,
  onCreated,
  eventId = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  eventId?: string | null;
}) {
  const { actor, can } = usePermissions();
  const staff = useActiveStaff();
  const defaults = useBusinessSettings().defaults.defaultTaskManagers;
  const events = useUpcomingEvents();
  const sops = useResource(["sops", "options"], () => sopsApi.list(), { reference: true });
  const delegates = can("tasks.delegate");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>(delegates ? "delegated" : "general");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [event, setEvent] = useState(eventId ?? "");
  const [sopId, setSopId] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [managers, setManagers] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!actor) return null;
  const defaultManagers = defaults.mode === "all_admins"
    ? staff.filter((member) => member.role === "admin").map((member) => member.id)
    : defaults.userIds.filter((id) => staff.some((member) => member.id === id));
  const selectedManagers = managers ?? defaultManagers;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (dueDate && !isBusinessTime(dueDate, dueTime || "17:00")) {
      setError("That time doesn't exist on that date in New York. Pick another time.");
      return;
    }
    setBusy(true);
    try {
      await tasksApi.create({
        title,
        type,
        priority,
        dueAt: dueDate
          ? businessTimeToUtc(dueDate, dueTime || "17:00").toISOString()
          : null,
        eventId: event || null,
        sopId: sopId || null,
        assigneeIds: assignees,
        ...(delegates && (managers !== null || staff.length) ? { managerIds: selectedManagers } : {}),
      });
      setTitle("");
      setSopId("");
      setAssignees([]);
      setManagers(null);
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={<T id="task-lists.new-task-drawer.new-task">New task</T>}
      description={<T id="task-lists.new-task-drawer.add-a-task-for-yourself">Add a task for yourself or the team.</T>}
    >
      <form className="task-form" onSubmit={submit}>
        <ErrorText message={error} />
        <FormField label={<T id="task-lists.new-task-drawer.title">Title</T>}>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.type">Type</T>}>
          <Dropdown value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {taskTypes.map((option) => (
              <option key={option} value={option}>
                {taskTypeLabels[option]}
              </option>
            ))}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.priority">Priority</T>}>
          <Dropdown
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {taskPriorities.map((option) => (
              <option key={option} value={option}>
                {taskPriorityLabels[option]}
              </option>
            ))}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.sop">SOP</T>}>
          <Dropdown value={sopId} onChange={(e) => setSopId(e.target.value)}>
            <option value="">No SOP</option>
            {(sops.data ?? []).map((sop) => <option key={sop.id} value={sop.id}>{sop.title} ({sop.category})</option>)}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.due-date">Due date</T>}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.due-time">Due time</T>}>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </FormField>
        {!eventId && (
          <FormField label={<T id="task-lists.new-task-drawer.event">Event</T>}>
            <Dropdown value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">No event</option>
              {events.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} ({option.date})
                </option>
              ))}
            </Dropdown>
          </FormField>
        )}
        {delegates ? (
          <>
            <FormField label={<T id="task-lists.new-task-drawer.assign-to">Assign to</T>} hint={<T id="task-lists.new-task-drawer.pick-one-or-more-people">Pick one or more people.</T>}>
              <Dropdown
                multiple
                value={assignees}
                onChange={(e) =>
                  setAssignees(Array.from(e.target.selectedOptions, (option) => option.value))
                }
              >
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.id === actor.userId ? `${member.name} (me)` : member.name}
                  </option>
                ))}
              </Dropdown>
            </FormField>
            <FormField
              label={<T id="task-lists.new-task-drawer.overseer">Managers</T>}
              hint={<T id="task-lists.new-task-drawer.when-you-assign-someone-else">Choose the people who manage this task.</T>}
            >
              <Dropdown multiple value={selectedManagers} onChange={(e) => setManagers(Array.from(e.target.selectedOptions, (option) => option.value))}>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Dropdown>
            </FormField>
          </>
        ) : (
          <label className="task-check">
            <RoundCheck
              checked={assignees.includes(actor.userId)}
              onChange={(e) => setAssignees(e.target.checked ? [actor.userId] : [])}
            />
            <T id="task-lists.new-task-drawer.assign-to-me">Assign to me</T>
          </label>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            <T id="task-lists.new-task-drawer.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            <T id="task-lists.new-task-drawer.add-task">Add task</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
