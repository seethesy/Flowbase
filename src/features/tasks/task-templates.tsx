import { Dropdown } from "../../components/ui/Dropdown";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  offsetLabel,
  taskTypeLabels,
  taskTypes,
  type TaskTemplate,
  type TaskType,
} from "../../../shared/tasks";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import {
  Button,
  DetailDrawer,
  EmptyState,
  FormField,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { tasksApi } from "../../services/tasks";
import { allPages, inventoryApi } from "../../services/core";
import { sopsApi } from "../../services/sops";
import { ListSelect } from "../common/list-fields";
import { T, useCopy, LabelT, joined } from "../../app/copy";
import "./tasks.css";

// offsetLabel's wording, editable live (FLOW-257). The clock part stays as
// offsetLabel formats it.
function OffsetText({ offsetDays, time }: { offsetDays: number; time: string | null }) {
  const days = Math.abs(offsetDays);
  const day =
    offsetDays === 0 ? (
      <T id="task-templates.offset.event-day">Event day</T>
    ) : offsetDays === -1 ? (
      <T id="task-templates.offset.day-before">Day before</T>
    ) : offsetDays === 1 ? (
      <T id="task-templates.offset.day-after">Day after</T>
    ) : offsetDays < 0 ? (
      <T id="task-templates.offset.days-before" values={{ days }}>{"T-{days} days"}</T>
    ) : (
      <T id="task-templates.offset.days-after" values={{ days }}>{"T+{days} days"}</T>
    );
  if (!time) return day;
  const clock = offsetLabel({ offsetDays: 0, time }).replace(/^Event day /, "");
  return <>{day} {clock}</>;
}

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
  const httpsPlaceholder = useCopy("task-templates.template-editor.https.placeholder", "https://");
  const [name, setName] = useState(template?.name ?? "");
  const [sopUrl, setSopUrl] = useState(template?.sopUrl ?? "");
  const [sopId, setSopId] = useState(template?.sopId ?? "");
  const [matchCatalogId, setMatchCatalogId] = useState(template?.matchCatalogId ?? "");
  const [matchLineKind, setMatchLineKind] = useState(template?.matchLineKind ?? "");
  const [matchEventType, setMatchEventType] = useState(template?.matchEventType ?? "");
  const services = useResource(["inventory", "service-options"], () => allPages((cursor) => inventoryApi.list({ kind: "service" }, cursor)), { reference: true });
  const sops = useResource(["sops", "options"], () => sopsApi.list(), { reference: true });
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
      sopId: sopId || null,
      matchCatalogId: matchCatalogId || null,
      matchLineKind: (matchLineKind || null) as TaskTemplate["matchLineKind"],
      matchEventType: matchEventType.trim() || null,
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
      title={template ? <T id="task-templates.template-editor.edit" values={{ name: template.name }}>{"Edit {name}"}</T> : <T id="task-templates.template-editor.new-task-template">New task template</T>}
      description={<T id="task-templates.template-editor.each-task-is-due-a">{"Each task is due a number of days from the event, at its own time or the event's start time."}</T>}
    >
      <form className="task-form" onSubmit={submit}>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label={<T id="task-templates.template-editor.template-name">Template name</T>}>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={<T id="task-templates.template-editor.sop-link">SOP link</T>} hint={<T id="task-templates.template-editor.optional-added-to-each-task">{"Optional. Added to each task's description."}</T>}>
          <input
            type="url"
            maxLength={2000}
            placeholder={httpsPlaceholder} data-copy-id="task-templates.template-editor.https.placeholder"
            value={sopUrl}
            onChange={(e) => setSopUrl(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="task-templates.template-editor.library-sop">Library SOP</T>} hint={<T id="task-templates.template-editor.opens-directly-from-each-task">Opens directly from each task created by this template.</T>}>
          <Dropdown value={sopId} onChange={(e) => setSopId(e.target.value)}>
            <option value="">No library SOP</option>
            {(sops.data ?? []).map((sop) => <option key={sop.id} value={sop.id}>{sop.title} ({sop.category})</option>)}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-templates.template-editor.service-offering">Service offering</T>} hint={<T id="task-templates.template-editor.automatically-apply-when-a-mapped">Automatically apply when a mapped proposal contains this offering.</T>}>
          <Dropdown value={matchCatalogId} onChange={(e) => setMatchCatalogId(e.target.value)}>
            <option value="">Any offering</option>
            {(services.data ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-templates.template-editor.proposal-line-type">Proposal line type</T>} hint={<T id="task-templates.template-editor.automatically-apply-when-a-mapped-2">Automatically apply when a mapped proposal contains this line type.</T>}>
          <Dropdown value={matchLineKind} onChange={(e) => setMatchLineKind(e.target.value)}>
            <option value="">Any type</option>
            {["menu", "rental", "decor", "service", "supply"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </Dropdown>
        </FormField>
        <FormField label={<T id="task-templates.template-editor.event-type">Event type</T>} hint={<T id="task-templates.template-editor.automatically-apply-to-events-of">Automatically apply to events of this type. Leave all three matches blank for a manual template.</T>}>
          <input maxLength={100} value={matchEventType} onChange={(e) => setMatchEventType(e.target.value)} />
        </FormField>
        <ol className="template-items">
          {items.map((item, index) => (
            <li key={item.id ?? `new-${index}`} aria-label={`Task ${index + 1}`}>
              <FormField label={<T id="task-templates.template-editor.task">Task</T>}>
                <input
                  required
                  maxLength={200}
                  value={item.title}
                  onChange={(e) => edit(index, { title: e.target.value })}
                />
              </FormField>
              <FormField label={<T id="task-templates.template-editor.type">Type</T>}>
                <Dropdown
                  value={item.type}
                  onChange={(e) => edit(index, { type: e.target.value as TaskType })}
                >
                  {taskTypes.map((option) => (
                    <option key={option} value={option}>
                      {taskTypeLabels[option]}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField label={<T id="task-templates.template-editor.when">When</T>}>
                <Dropdown
                  value={item.when}
                  onChange={(e) => edit(index, { when: e.target.value as Draft["when"] })}
                >
                  <option value="before">Days before the event</option>
                  <option value="on">On the event day</option>
                  <option value="after">Days after the event</option>
                </Dropdown>
              </FormField>
              {item.when !== "on" && (
                <FormField label={<T id="task-templates.template-editor.days">Days</T>}>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={item.days}
                    onChange={(e) => edit(index, { days: e.target.value })}
                  />
                </FormField>
              )}
              <FormField label={<T id="task-templates.template-editor.time">Time</T>} hint={<T id="task-templates.template-editor.blank-the-event-s-start">{"Blank = the event's start time."}</T>}>
                <input
                  type="time"
                  value={item.time}
                  onChange={(e) => edit(index, { time: e.target.value })}
                />
              </FormField>
              <FormField label={<T id="task-templates.template-editor.default-position">Default position</T>}>
                <ListSelect
                  list="staff_position"
                  empty="Any position"
                  value={item.position}
                  onChange={(value) => edit(index, { position: value })}
                />
              </FormField>
              <p className="template-offset">
                <OffsetText offsetDays={offsetOf(item)} time={item.time || null} />
              </p>
              {items.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <T id="task-templates.template-editor.remove-task" values={{ value: index + 1 }}>{"Remove task {value}"}</T>
                </Button>
              )}
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={() => setItems([...items, blankItem()])}>
          <T id="task-templates.template-editor.add-another-task">Add another task</T>
        </Button>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            <T id="task-templates.template-editor.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            <T id="task-templates.template-editor.save-template">Save template</T>
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
        <T id="task-templates.task-templates.tasks">← Tasks</T>
      </Link>
      <PageHeader pageKey="tasks.templates"
        title={<T id="task-templates.task-templates.task-templates">Task templates</T>}
        subtitle={<T id="task-templates.task-templates.reusable-sets-of-tasks-due">{"Reusable sets of tasks, due relative to the event. Apply one from an event's Tasks section."}</T>}
      >
        {manage && <Button onClick={() => setEditing("new")}><T id="task-templates.task-templates.new-template">New template</T></Button>}
      </PageHeader>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <PageGrid pageKey="tasks.templates">
      <Block id="templates" name="Templates" h={24}>
      {templates.data.length ? (
        templates.data.map((template) => (
          <Section
            key={template.id}
            title={template.name}
            action={
              manage && (
                <div className="page-actions">
                  <Button variant="outline" onClick={() => setEditing(template)}>
                    <T id="task-templates.task-templates.edit">Edit</T>
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
                    <T id="task-templates.task-templates.archive">Archive</T>
                  </Button>
                </div>
              )
            }
          >
            {template.sopUrl && (
              <p>
                <a href={template.sopUrl} target="_blank" rel="noreferrer">
                  <T id="task-templates.task-templates.sop">SOP</T>
                </a>
              </p>
            )}
            {template.sopId && <p><Link to={`/sops/${template.sopId}`}><T id="task-templates.task-templates.library-sop">Library SOP</T></Link></p>}
            {(template.matchCatalogId || template.matchLineKind || template.matchEventType) && <p className="muted"><T id="task-templates.task-templates.automatic-match" values={{ join: [
              template.matchCatalogId && "service offering",
              template.matchLineKind && `${template.matchLineKind} line`,
              template.matchEventType && `${template.matchEventType} event`,
            ].filter(Boolean).join(" · ") }}>{"Automatic match: {join}"}</T></p>}
            <ul className="task-lines">
              {template.items.map((item) => (
                <li key={item.id} className="task-line">
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {joined([<OffsetText offsetDays={item.offsetDays} time={item.time} />, <LabelT id="labels.task-type" value={item.type}>{taskTypeLabels[item.type]}</LabelT>, item.position])}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ))
      ) : (
        <EmptyState title={<T id="task-templates.task-templates.no-task-templates">No task templates</T>} description={<T id="task-templates.task-templates.templates-you-add-appear-here">Templates you add appear here.</T>} />
      )}
      </Block>
      </PageGrid>
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
