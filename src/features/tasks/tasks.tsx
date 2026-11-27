import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Dropdown } from "../../components/ui/Dropdown";
import { PeoplePicker } from "../../components/ui/people-picker";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  taskTypeLabels,
  type Task,
  type TaskStatus,
} from "../../../shared/tasks";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { Button, FormField, LoadingSkeleton, PageHeader, Section, ErrorText } from "../../components/shared";
import { staffApi } from "../../services/staff";
import { tasksApi } from "../../services/tasks";
import { sopsApi } from "../../services/sops";
import { Attachments } from "../common/attachments";
import { dateTimeLabel } from "../inventory/inventory-labels";
import "./tasks.css";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy, LabelT } from "../../app/copy";

// One task (FLOW-58): where a task notification leads (FLOW-43). Anyone who can
// see the task changes its status, claims it, works its checklist and comments.
// Whoever manages it reassigns it and changes its managers (FLOW-60). The lists
// and dashboard are in task-lists.tsx.

const names = (people: { name: string }[]) =>
  people.map((person) => person.name).join(", ") || "—";

function NotesEditor({ notes, save, busy }: { notes: string; save: (notes: string) => void; busy: boolean }) {
  const [value, setValue] = useState(notes);
  return <form onSubmit={(event) => { event.preventDefault(); save(value); }}>
    <textarea aria-label="Task notes" rows={5} maxLength={5000} value={value} onChange={(event) => setValue(event.target.value)} />
    <Button type="submit" disabled={busy || value === notes}><T id="tasks.task-detail.save-notes">Save notes</T></Button>
  </form>;
}

function AssignmentHistory({ id }: { id: string }) {
  const history = useResource(["tasks", id, "assignments"], () => tasksApi.assignments(id));
  if (history.error) return <ErrorText message={history.error} />;
  if (!history.data) return <LoadingSkeleton />;
  return <ul>{history.data.map((entry) => <li key={entry.id}>
    {entry.user.name} · {entry.action === "added" ? <T id="tasks.task-detail.assigned">Assigned</T> : <T id="tasks.task-detail.removed">Removed</T>}
    {entry.actor && <> · {entry.actor.name}</>} · {dateTimeLabel(entry.at)}
  </li>)}</ul>;
}

// Reassigning (FLOW-60 AC3) and the managers, for whoever manages the task.
function Reassign({
  task,
  busy,
  onSave,
}: {
  task: Task;
  busy: boolean;
  onSave: (assigneeIds: string[], managerIds: string[]) => void;
}) {
  const staff = useResource(["staff"], () => staffApi.list(), { reference: true });
  const [assignees, setAssignees] = useState(task.assignees.map((person) => person.id));
  const [managers, setManagers] = useState(task.managers.map((person) => person.id));
  const active = (staff.data ?? []).filter(
    (member) => member.active || assignees.includes(member.id) || managers.includes(member.id),
  );
  return (
    <form
      className="task-reassign"
      aria-label="Reassign"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(assignees, managers);
      }}
    >
      <FormField label={<T id="tasks.reassign.assigned-to">Assigned to</T>} hint={<T id="tasks.reassign.pick-one-or-more-people">Pick one or more people.</T>}>
        <PeoplePicker staff={active} kind="assignees" value={assignees} onChange={setAssignees} />
      </FormField>
      <FormField label={<T id="tasks.reassign.overseer">Managers</T>}>
        <PeoplePicker staff={active} kind="managers" value={managers} onChange={setManagers} />
      </FormField>
      <Button type="submit" variant="outline" disabled={busy}>
        <T id="tasks.reassign.save-assignment">Save assignment</T>
      </Button>
    </form>
  );
}

export function TaskDetail() {
  const addAChecklistItemPlaceholder = useCopy("tasks.task-detail.add-a-checklist-item.placeholder", "Add a checklist item");
  const writeACommentPlaceholder = useCopy("tasks.task-detail.write-a-comment.placeholder", "Write a comment");
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { actor, can } = usePermissions();
  const task = useResource(["tasks", id], () => tasksApi.get(id));
  const sops = useResource(["sops", "options"], () => sopsApi.list(), { reference: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  const [archived, setArchived] = useState(false);
  if (task.error) return <ErrorText message={task.error} />;
  if (!task.data) return <LoadingSkeleton />;
  const data = task.data;
  if (archived) return <><p role="status"><T id="tasks.task-detail.deleted">Task deleted.</T></p>
    <Button onClick={async () => { try { await tasksApi.setArchived(id, false); setArchived(false); task.reload(); } catch (cause) { setError((cause as Error).message); } }}>
      <T id="tasks.task-detail.undo">Undo</T></Button><ErrorText message={error} /></>;
  const act = async (change: () => Promise<Task>, after?: () => void) => {
    setBusy(true);
    setError("");
    try {
      task.replace(await change());
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addItem = (event: FormEvent) => {
    event.preventDefault();
    if (!item.trim()) return;
    void act(() => tasksApi.addChecklistItem(id, item.trim()), () => setItem(""));
  };
  const addComment = (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    void act(() => tasksApi.addComment(id, comment.trim()), () => setComment(""));
  };
  return (
    <>
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <T id="tasks.task-detail.back">← Back</T>
      </button>
      <PageHeader pageKey="tasks.detail"
        eyebrow={<T id="tasks.task-detail.task">Task</T>}
        title={data.title}
        subtitle={<T id="tasks.task-detail.priority" values={{ taskTypeLabels: <LabelT id="labels.task-type" value={data.type}>{taskTypeLabels[data.type]}</LabelT>, taskPriorityLabels: <LabelT id="labels.task-priority" value={data.priority}>{taskPriorityLabels[data.priority]}</LabelT> }}>{"{taskTypeLabels} · {taskPriorityLabels} priority"}</T>}
      >{data.canManage && <Button variant="outline" disabled={busy} onClick={async () => {
        try { await tasksApi.setArchived(id, true); setArchived(true); } catch (cause) { setError((cause as Error).message); }
      }}><T id="tasks.task-detail.delete">Delete</T></Button>}</PageHeader>
      <ErrorText message={error} />
      <PageGrid pageKey="tasks.detail" record={{ source: "tasks", id, row: data as unknown as Record<string, unknown> }}>
      <Block id="details" name="Task details" h={14}>
      <Section title={<T id="tasks.task-detail.details">Details</T>}>
        <div className="task-detail">
          <FormField label={<T id="tasks.task-detail.status">Status</T>}>
            <Dropdown
              value={data.status}
              disabled={busy}
              onChange={(e) =>
                void act(() =>
                  tasksApi.update(id, { status: e.target.value as TaskStatus }),
                )
              }
            >
              {taskStatuses.map((status) => (
                <option key={status} value={status}>
                  {taskStatusLabels[status]}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {actor &&
            data.status !== "done" &&
            !data.assignees.some((person) => person.id === actor.userId) &&
            can("tasks.write") && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    tasksApi.claim(id),
                  )
                }
              >
                <T id="tasks.task-detail.pick-up">Pick up</T>
              </Button>
            )}
          {actor && data.assignees.some((person) => person.id === actor.userId) &&
            <Button variant="outline" disabled={busy} onClick={() => void act(() => tasksApi.drop(id))}>
              <T id="tasks.task-detail.drop">Drop</T></Button>}
          <dl>
            <dt><T id="tasks.task-detail.due">Due</T></dt>
            <dd>{data.dueAt ? dateTimeLabel(data.dueAt) : "—"}</dd>
            <dt><T id="tasks.task-detail.assigned-to">Assigned to</T></dt>
            <dd>{names(data.assignees)}</dd>
            <dt><T id="tasks.task-detail.overseer">Managers</T></dt>
            <dd>{names(data.managers)}</dd>
            {data.position && (
              <>
                <dt><T id="tasks.task-detail.position">Position</T></dt>
                <dd>{data.position}</dd>
              </>
            )}
            <dt><T id="tasks.task-detail.created-by">Created by</T></dt>
            <dd>{data.creator?.name ?? <T id="tasks.task-detail.system">System</T>}</dd>
            {data.eventId && (
              <>
                <dt><T id="tasks.task-detail.event">Event</T></dt>
                <dd>
                  {data.eventTitle ? (
                    <Link to={`/events/${data.eventId}`}>{data.eventTitle}</Link>
                  ) : (
                    <T id="tasks.task-detail.another-event">Another event</T>
                  )}
                </dd>
              </>
            )}
            {data.completedAt && (
              <>
                <dt><T id="tasks.task-detail.completed">Completed</T></dt>
                <dd>
                  {dateTimeLabel(data.completedAt)}
                  {data.completedBy && <T id="tasks.task-detail.by" values={{ name: data.completedBy.name }}>{" by {name}"}</T>}
                </dd>
              </>
            )}
          </dl>
          {data.description && <p className="task-description">{data.description}</p>}
          {data.sopId && <Button asChild variant="outline"><Link to={`/sops/${data.sopId}`}><T id="tasks.task-detail.open-sop">Open SOP</T></Link></Button>}
          {data.canManage && <FormField label={<T id="tasks.task-detail.linked-sop">Linked SOP</T>}>
            <Dropdown value={data.sopId ?? ""} disabled={busy} onChange={(e) =>
              void act(() => tasksApi.update(id, { sopId: e.target.value || null }))}>
              <option value="">No SOP</option>
              {(sops.data ?? []).map((sop) => <option key={sop.id} value={sop.id}>{sop.title} ({sop.category})</option>)}
            </Dropdown>
          </FormField>}
          {data.canManage && (
            <Reassign
              key={data.updatedAt}
              task={data}
              busy={busy}
              onSave={(assigneeIds, managerIds) =>
                void act(() => tasksApi.update(id, { assigneeIds, managerIds }))
              }
            />
          )}
        </div>
      </Section>
      </Block>
      <Block id="notes" name="Notes" h={8}><Section title={<T id="tasks.task-detail.notes">Notes</T>}>
        {data.canManage || data.assignees.some((person) => person.id === actor?.userId)
          ? <NotesEditor key={data.updatedAt} notes={data.notes} busy={busy} save={(notes) => void act(() => tasksApi.update(id, { notes }))} />
          : <p>{data.notes}</p>}
      </Section></Block>
      <Block id="assignments" name="Assignment history" h={8}><Section title={<T id="tasks.task-detail.assignment-history">Assignment history</T>}>
        <AssignmentHistory id={id} />
      </Section></Block>
      <Block id="checklist" name="Checklist" h={12}>
      <Section title={<T id="tasks.task-detail.checklist" values={{ checklistDone: data.checklistDone, checklistTotal: data.checklistTotal }}>{"Checklist ({checklistDone}/{checklistTotal})"}</T>}>
        <ul className="task-checklist">
          {data.checklist.map((entry) => (
            <li key={entry.id}>
              <label>
                <RoundCheck
                  checked={entry.done}
                  disabled={busy}
                  onChange={(e) =>
                    void act(() =>
                      tasksApi.updateChecklistItem(id, entry.id, {
                        done: e.target.checked,
                      }),
                    )
                  }
                />
                <span>{entry.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <form className="task-inline-form" onSubmit={addItem}>
          <input
            aria-label="New checklist item"
            placeholder={addAChecklistItemPlaceholder} data-copy-id="tasks.task-detail.add-a-checklist-item.placeholder"
            maxLength={300}
            value={item}
            onChange={(e) => setItem(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy || !item.trim()}>
            <T id="tasks.task-detail.add">Add</T>
          </Button>
        </form>
      </Section>
      </Block>
      <Block id="comments" name="Comments" h={12}>
      <Section title={<T id="tasks.task-detail.comments">Comments</T>}>
        <ul className="task-comments">
          {data.comments.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.author?.name ?? <T id="tasks.task-detail.system">System</T>}</strong>
              <small>{dateTimeLabel(entry.createdAt)}</small>
              <p>{entry.body}</p>
            </li>
          ))}
        </ul>
        <form className="task-inline-form" onSubmit={addComment}>
          <textarea
            aria-label="New comment"
            placeholder={writeACommentPlaceholder} data-copy-id="tasks.task-detail.write-a-comment.placeholder"
            rows={2}
            maxLength={5000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy || !comment.trim()}>
            <T id="tasks.task-detail.comment">Comment</T>
          </Button>
        </form>
      </Section>
      </Block>
      <Block id="attachments" name="Task attachments" h={8}><Attachments recordType="task" recordId={id} /></Block>
      </PageGrid>
    </>
  );
}
