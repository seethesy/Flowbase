import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  offsetLabel,
  taskTypeLabels,
  taskTypes,
  type TaskTemplate,
  type TaskType,
} from "../../shared/tasks";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  EmptyState,
  FormField,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { tasksApi } from "../services/tasks";
import { ListSelect } from "./list-fields";
import "./tasks.css";

// Task templates (FLOW-62) at /tasks/templates: named sets of tasks due relative
// to an event, applied from the event hub's Tasks section. Managers edit them
// (tasks.templates); everyone who delegates can apply them.

type Draft = {
  id?: string;
  title: string;
  type: TaskType;
  // Days from the event: "before" counts back, "after" forward.
  days: string;
  when: "before" | "on" | "after";
  time: string;
  position: string;
};
const blankItem = (): Draft => ({
  title: "",
  type: "production",
  days: "1",
  when: "before",
  time: "",
  position: "",
});
const toDraft = (item: TaskTemplate["items"][number]): Draft => ({
  id: item.id,
  title: item.title,
  type: item.type,
  days: String(Math.abs(item.offsetDays)),
  when: item.offsetDays < 0 ? "before" : item.offsetDays > 0 ? "after" : "on",
  time: item.time ?? "",
  position: item.position ?? "",
});
const offsetOf = (draft: Draft) => {
  const days = Math.round(Number(draft.days) || 0);
  return draft.when === "on" ? 0 : draft.when === "before" ? -days : days;
};

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: TaskTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [sopUrl, setSopUrl] = useState(template?.sopUrl ?? "");
  const [items, setItems] = useState<Draft[]>(
    template?.items.map(toDraft) ?? [blankItem()],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (index: number, change: Partial<Draft>) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const input = {
      name,
      sopUrl: sopUrl.trim() || null,
      items: items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        title: item.title,
        type: item.type,
        offsetDays: offsetOf(item),
        time: item.time || null,
        position: item.position || null,
      })),
    };
    try {
      if (template) await tasksApi.updateTemplate(template.id, input);
      else await tasksApi.createTemplate(input);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      open
      wide
      onClose={onClose}
      title={template ? `Edit ${template.name}` : "New task template"}
      description="Each task is due a number of days from the event, at its own time or the event's start time."
    >
      <form className="task-form" onSubmit={submit}>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Template name">
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="SOP link" hint="Optional. Added to each task's description.">
          <input
            type="url"
            maxLength={2000}
            placeholder="https://"
            value={sopUrl}
            onChange={(e) => setSopUrl(e.target.value)}
          />
        </FormField>
        <ol className="template-items">
          {items.map((item, index) => (
            <li key={item.id ?? `new-${index}`} aria-label={`Task ${index + 1}`}>
              <FormField label="Task">
                <input
                  required
                  maxLength={200}
                  value={item.title}
                  onChange={(e) => edit(index, { title: e.target.value })}
                />
              </FormField>
              <FormField label="Type">
                <select
                  value={item.type}
                  onChange={(e) => edit(index, { type: e.target.value as TaskType })}
                >
                  {taskTypes.map((option) => (
                    <option key={option} value={option}>
                      {taskTypeLabels[option]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="When">
                <select
                  value={item.when}
                  onChange={(e) => edit(index, { when: e.target.value as Draft["when"] })}
                >
                  <option value="before">Days before the event</option>
                  <option value="on">On the event day</option>
                  <option value="after">Days after the event</option>
                </select>
              </FormField>
              {item.when !== "on" && (
                <FormField label="Days">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={item.days}
                    onChange={(e) => edit(index, { days: e.target.value })}
                  />
                </FormField>
              )}
              <FormField label="Time" hint="Blank = the event's start time.">
                <input
                  type="time"
                  value={item.time}
                  onChange={(e) => edit(index, { time: e.target.value })}
                />
              </FormField>
              <FormField label="Default position">
                <ListSelect
                  list="staff_position"
                  empty="Any position"
                  value={item.position}
                  onChange={(value) => edit(index, { position: value })}
                />
              </FormField>
              <p className="template-offset">
                {offsetLabel({ offsetDays: offsetOf(item), time: item.time || null })}
              </p>
              {items.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  Remove task {index + 1}
                </Button>
              )}
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={() => setItems([...items, blankItem()])}>
          Add another task
        </Button>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Save template
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function TaskTemplates() {
  const { can } = usePermissions();
  const templates = useResource(["tasks", "templates"], () => tasksApi.templates());
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);
  const [error, setError] = useState("");
  const manage = can("tasks.templates");
  if (templates.error) return <LoadError message={templates.error} />;
  if (!templates.data) return <LoadingSkeleton />;
  return (
    <>
      <Link className="back-link" to="/tasks">
        ← Tasks
      </Link>
      <PageHeader
        title="Task templates"
        subtitle="Reusable sets of tasks, due relative to the event. Apply one from an event's Tasks section."
      >
        {manage && <Button onClick={() => setEditing("new")}>New template</Button>}
      </PageHeader>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {templates.data.length ? (
        templates.data.map((template) => (
          <Section
            key={template.id}
            title={template.name}
            action={
              manage && (
                <div className="page-actions">
                  <Button variant="outline" onClick={() => setEditing(template)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      setError("");
                      try {
                        await tasksApi.archiveTemplate(template.id);
                        templates.reload();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    Archive
                  </Button>
                </div>
              )
            }
          >
            {template.sopUrl && (
              <p>
                <a href={template.sopUrl} target="_blank" rel="noreferrer">
                  SOP
                </a>
              </p>
            )}
            <ul className="task-lines">
              {template.items.map((item) => (
                <li key={item.id} className="task-line">
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {[offsetLabel(item), taskTypeLabels[item.type], item.position]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ))
      ) : (
        <EmptyState title="No task templates" description="Templates you add appear here." />
      )}
      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={templates.reload}
        />
      )}
    </>
  );
}
