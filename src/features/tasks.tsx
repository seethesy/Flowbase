import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  taskTypeLabels,
  type Task,
  type TaskStatus,
} from "../../shared/tasks";
import { useResource } from "../app/useResource";
import { Button, FormField, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { tasksApi } from "../services/tasks";
import { Attachments } from "./attachments";
import { dateTimeLabel } from "./inventory-labels";
import "./tasks.css";

// One task (FLOW-58): where a task notification leads (FLOW-43). Anyone who can
// see the task changes its status, works its checklist and comments. Task lists,
// filters and delegation screens are FLOW-59 and FLOW-60.

const names = (people: { name: string }[]) =>
  people.map((person) => person.name).join(", ") || "—";

export function TaskDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const task = useResource(["tasks", id], () => tasksApi.get(id));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  if (task.error) return <LoadError message={task.error} />;
  if (!task.data) return <LoadingSkeleton />;
  const data = task.data;
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
        ← Back
      </button>
      <PageHeader
        eyebrow="Task"
        title={data.title}
        subtitle={`${taskTypeLabels[data.type]} · ${taskPriorityLabels[data.priority]} priority`}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <Section title="Details">
        <div className="task-detail">
          <FormField label="Status">
            <select
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
            </select>
          </FormField>
          <dl>
            <dt>Due</dt>
            <dd>{data.dueAt ? dateTimeLabel(data.dueAt) : "—"}</dd>
            <dt>Assigned to</dt>
            <dd>{names(data.assignees)}</dd>
            <dt>Overseer</dt>
            <dd>{data.overseer?.name ?? "—"}</dd>
            <dt>Created by</dt>
            <dd>{data.creator?.name ?? "System"}</dd>
            {data.eventId && (
              <>
                <dt>Event</dt>
                <dd>
                  {data.eventTitle ? (
                    <Link to={`/events/${data.eventId}`}>{data.eventTitle}</Link>
                  ) : (
                    "Another event"
                  )}
                </dd>
              </>
            )}
            {data.completedAt && (
              <>
                <dt>Completed</dt>
                <dd>
                  {dateTimeLabel(data.completedAt)}
                  {data.completedBy && ` by ${data.completedBy.name}`}
                </dd>
              </>
            )}
          </dl>
          {data.description && <p className="task-description">{data.description}</p>}
        </div>
      </Section>
      <Section title={`Checklist (${data.checklistDone}/${data.checklistTotal})`}>
        <ul className="task-checklist">
          {data.checklist.map((entry) => (
            <li key={entry.id}>
              <label>
                <input
                  type="checkbox"
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
            placeholder="Add a checklist item"
            maxLength={300}
            value={item}
            onChange={(e) => setItem(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy || !item.trim()}>
            Add
          </Button>
        </form>
      </Section>
      <Section title="Comments">
        <ul className="task-comments">
          {data.comments.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.author?.name ?? "System"}</strong>
              <small>{dateTimeLabel(entry.createdAt)}</small>
              <p>{entry.body}</p>
            </li>
          ))}
        </ul>
        <form className="task-inline-form" onSubmit={addComment}>
          <textarea
            aria-label="New comment"
            placeholder="Write a comment"
            rows={2}
            maxLength={5000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy || !comment.trim()}>
            Comment
          </Button>
        </form>
      </Section>
      <Attachments recordType="task" recordId={id} />
    </>
  );
}
