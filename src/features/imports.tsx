import { Dropdown } from "../components/ui/Dropdown";
import { Block, PageGrid } from "../app/page-grid";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  applyTransformsWithNotes,
  autoMap,
  batches,
  headingIndex,
  mapRows,
  type ImportLog,
  type ImportModuleInfo,
  type ImportRowPlan,
  type ImportRowResult,
} from "../../shared/imports";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { readImportFile, type Sheet } from "../services/import-files";
import { importsApi } from "../services/imports";
import { LoadError } from "../components/record-display";
import { dateTimeLabel } from "./inventory-labels";
import { T, LabelT } from "../app/copy";
import "./inventory.css";
import "./imports.css";
import { InventoryHeading } from "./inventory-screen";

// What the dry run will do with each row (FLOW-257: editable under imports.dry-run-report.action).
const planActionLabels: Record<string, string> = { skip: "Unchanged", update: "Updates", create: "Creates" };

// Data import (FLOW-47): choose a CSV or XLSX file, map its columns, check the
// rows (dry run), then import them in batches of 100. The browser parses the file
// (ADR-09); the API checks and writes. Each module importer (inventory, recipes,
// leads) appears here once its ticket registers it.

// The Inventory screen's Imports tab (FLOW-266): a card per importer the viewer
// may run, with when it last ran and who ran it, then the recent imports. Import
// records are a history: they can be opened but not edited or deleted.
const importerDescriptions: Record<string, ReactNode> = {
  master_inventory: <T id="imports.import-list.master-inventory-description">Rentals, decor and supplies with categories, types, storage and quantities.</T>,
  bar_inventory: <T id="imports.import-list.bar-inventory-description">Liquor, wine, beer and mixers with tiers, containers and distributors.</T>,
  kitchen_ingredients: <T id="imports.import-list.kitchen-ingredients-description">Ingredients and kitchen supplies with units, vendors, costs and par levels.</T>,
  recipe_book: <T id="imports.import-list.recipe-book-description">Recipes with their ingredients, yields and methods.</T>,
  leads: <T id="imports.import-list.leads-description">Leads from a spreadsheet, with contacts, dates and guest counts.</T>,
};
// FLOW-300: the preview's five importers. The last three show as cards before
// their importers exist (FLOW-89, FLOW-99, FLOW-101's spreadsheet import), with
// no Import file button until the API registers them.
const plannedImporters = [
  { key: "kitchen_ingredients", label: "Kitchen ingredients" },
  { key: "recipe_book", label: "Recipe book" },
  { key: "leads", label: "Leads" },
];
export function ImportList() {
  const modules = useResource(["imports", "modules"], () => importsApi.modules());
  const logs = useResource(["imports", "logs", undefined, 0], () => importsApi.list(undefined), { keepPrevious: true });
  const lastRun = (key: string) => logs.data?.find((log) => log.module === key);
  const cards = modules.data ? [
    ...modules.data.map((module) => ({ key: module.key, label: module.label, available: true })),
    ...plannedImporters.filter((planned) => !modules.data!.some((module) => module.key === planned.key))
      .map((planned) => ({ ...planned, available: false })),
  ] : [];
  return (
    <>
      <InventoryHeading tab="imports" />
      <PageGrid pageKey="imports.list">
      <Block id="importers" name="Importers" h={8}>
        {modules.error ? (
          <LoadError message={modules.error} />
        ) : !modules.data ? (
          <LoadingSkeleton />
        ) : (
          <ul className="import-cards" aria-label="Importers">
            {cards.map((module) => {
              const last = lastRun(module.key);
              return (
                <li key={module.key}>
                  <h3>
                    {module.available
                      ? <Link to={`/imports/${encodeURIComponent(module.key)}`}>{module.label}</Link>
                      : <LabelT id="labels.importer" value={module.key}>{module.label}</LabelT>}
                  </h3>
                  {importerDescriptions[module.key] && <p>{importerDescriptions[module.key]}</p>}
                  <small>
                    {last
                      ? <T id="imports.import-list.last-run" values={{ date: dateTimeLabel(last.createdAt), name: last.createdByName ?? "—" }}>{"Last run {date} by {name}"}</T>
                      : <T id="imports.import-list.never-run">Never run</T>}
                  </small>
                  {module.available ? (
                    <Button variant="outline" asChild>
                      <Link to={`/imports/${encodeURIComponent(module.key)}`}>
                        <T id="imports.import-list.import-file">Import file</T>
                      </Link>
                    </Button>
                  ) : (
                    <small className="muted"><T id="imports.import-list.not-available-yet">Not available yet</T></small>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Block>
      <Block id="log" name="Import log" h={16}>
      <ImportLogTable />
      </Block>
      </PageGrid>
    </>
  );
}

export function ImportPage() {
  const { module: key = "" } = useParams();
  const module = useResource(["imports", "module", key], () => importsApi.module(key));
  return (
    <>
      <PageHeader pageKey="imports.detail"
        eyebrow={<T id="imports.import-page.imports">Imports</T>}
        title={module.data ? <T id="imports.import-page.import" values={{ label: module.data.label }}>{"Import {label}"}</T> : <T id="imports.import-page.import-2">Import</T>}
        subtitle={<T id="imports.import-page.choose-a-csv-or-excel">Choose a CSV or Excel (.xlsx) file. Nothing is saved until you import.</T>}
      >
        <Button asChild variant="outline">
          <Link to="/imports"><T id="imports.import-page.all-imports">All imports</T></Link>
        </Button>
      </PageHeader>
      {module.error ? (
        <LoadError message={module.error} />
      ) : !module.data ? (
        <LoadingSkeleton />
      ) : (
        <ImportFlow key={module.data.key} module={module.data} />
      )}
    </>
  );
}

type Loaded = { name: string; sheet: Sheet };
type Committed = { log: ImportLog; failures: ImportRowResult[] };
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function ImportFlow({ module }: { module: ImportModuleInfo }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [plans, setPlans] = useState<ImportRowPlan[] | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [logVersion, setLogVersion] = useState(0);

  const headings = useMemo(() => {
    if (!file) return [];
    const index = headingIndex(file.sheet);
    return index === -1 ? [] : file.sheet[index].map((cell) => cell.trim());
  }, [file]);
  const transformed = useMemo(
    () =>
      file
        ? applyTransformsWithNotes(mapRows(file.sheet, mapping), module.transforms)
        : { rows: [], notes: [] },
    [file, mapping, module.transforms],
  );
  const rows = transformed.rows;
  const missing = module.fields.filter(
    (field) => field.required && (mapping[field.key] ?? null) === null,
  );

  const choose = async (chosen: File | undefined) => {
    setPlans(null);
    setCommitted(null);
    setError("");
    if (!chosen) return setFile(null);
    try {
      const sheet = await readImportFile(chosen);
      const index = headingIndex(sheet);
      if (index === -1) throw new Error("The file is empty.");
      setFile({ name: chosen.name, sheet });
      setMapping(autoMap(sheet[index], module.fields));
    } catch (failure) {
      setFile(null);
      setError((failure as Error).message);
    }
  };
  const remap = (field: string, column: string) => {
    setPlans(null);
    setCommitted(null);
    setMapping((current) => ({
      ...current,
      [field]: column === "" ? null : Number(column),
    }));
  };

  // The dry run, one request per 100 rows (FLOW-47 AC3).
  const check = async () => {
    setError("");
    setCommitted(null);
    const all: ImportRowPlan[] = [];
    try {
      const parts = batches(rows);
      for (const [index, part] of parts.entries()) {
        setBusy(`Checking rows… ${index + 1} of ${parts.length}`);
        all.push(...(await importsApi.dryRun(module.key, part)));
      }
      setPlans(all);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy("");
    }
  };

  // Commits in batches; a failed row is reported and the rest carry on (AC2).
  const commit = async () => {
    if (!file) return;
    setError("");
    const failures: ImportRowResult[] = [];
    try {
      let log = await importsApi.start({
        module: module.key,
        fileName: file.name,
        rowCount: rows.length,
      });
      const parts = batches(rows);
      for (const [index, part] of parts.entries()) {
        setBusy(`Importing… ${index + 1} of ${parts.length}`);
        const result = await importsApi.batch(log.id, part);
        failures.push(
          ...result.results.filter((row) => row.outcome === "failed"),
        );
        log = result.log;
      }
      log = await importsApi.complete(log.id);
      setCommitted({ log, failures });
      setPlans(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy("");
      setLogVersion((current) => current + 1);
    }
  };

  return (
    <>
      <PageGrid pageKey="imports.detail">
      <Block id="file" name="Import file" h={8}>
      <Section title={<T id="imports.import-flow.file">File</T>}>
        <label className="form-field">
          <span><T id="imports.import-flow.file">File</T></span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              // Lets the same file be chosen again after it changes on disk.
              event.target.value = "";
            }}
          />
        </label>
        {file && (
          <p className="muted">
            <T id="imports.import-flow.to-import" values={{ name: file.name, plural: plural(rows.length, "row") }}>{"{name}: {plural} to import."}</T>
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </Section>

      </Block>
      <Block id="columns" name="Column mapping" h={14}>
      {file && (
        <Section title={<T id="imports.import-flow.columns">Columns</T>}>
          <div className="import-mapping">
            {module.fields.map((field) => (
              <label className="form-field" key={field.key}>
                <span>
                  {field.label}
                  {field.required && <T id="imports.import-flow.required">{" (required)"}</T>}
                </span>
                <Dropdown
                  aria-label={field.label}
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => remap(field.key, event.target.value)}
                >
                  <option value="">— Not in file —</option>
                  {headings.map((heading, index) => (
                    <option key={index} value={index}>
                      {heading || `Column ${index + 1}`}
                    </option>
                  ))}
                </Dropdown>
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="error-message">
              <T id="imports.import-flow.choose-a-column-for">{"Choose a column for "}</T>{missing.map((field) => field.label).join(", ")}.
            </p>
          )}
          <div className="import-actions">
            <Button
              type="button"
              disabled={!rows.length || missing.length > 0 || Boolean(busy)}
              onClick={() => void check()}
            >
              <T id="imports.import-flow.check-rows">Check rows</T>
            </Button>
          </div>
        </Section>
      )}

      </Block>
      <Block id="results" name="Import results" h={16}>
      {busy && (
        <p role="status" className="import-progress">
          {busy}
        </p>
      )}

      {plans && (
        <DryRunReport
          plans={plans}
          dropped={transformed.notes}
          busy={Boolean(busy)}
          onImport={() => void commit()}
        />
      )}

      {committed && <CommitSummary committed={committed} />}

      </Block>
      <Block id="history" name="Import history" h={12}><ImportLogTable module={module.key} version={logVersion} /></Block>
      </PageGrid>
    </>
  );
}

function DryRunReport({
  plans,
  dropped,
  busy,
  onImport,
}: {
  plans: ImportRowPlan[];
  // Rows the importer's row rules skipped, merged or renamed before the check.
  dropped: { rowNumber: number; text: string }[];
  busy: boolean;
  onImport: () => void;
}) {
  const count = (action: ImportRowPlan["action"]) =>
    plans.filter((plan) => plan.action === action).length;
  const errors = plans.filter((plan) => plan.action === "error");
  const duplicates = plans.filter((plan) => plan.duplicates.length > 0);
  // Rows sharing a key: the later one updates what the earlier one created.
  const firstRow = new Map<string, number>();
  const repeated: { rowNumber: number; firstRow: number }[] = [];
  for (const plan of plans) {
    if (!plan.externalKey) continue;
    const first = firstRow.get(plan.externalKey);
    if (first === undefined) firstRow.set(plan.externalKey, plan.rowNumber);
    else repeated.push({ rowNumber: plan.rowNumber, firstRow: first });
  }
  const importable = plans.length - errors.length;
  const described = plans.filter((plan) => plan.summary && plan.action !== "error");
  const reviewed = plans.filter((plan) => plan.notes?.length);
  return (
    <Section title={<T id="imports.dry-run-report.dry-run">Dry run</T>}>
      <ul className="import-summary" aria-label="Dry run summary">
        <li><T id="imports.dry-run-report.to-create" values={{ count: count("create") }}>{"{count} to create"}</T></li>
        <li><T id="imports.dry-run-report.to-update" values={{ count: count("update") }}>{"{count} to update"}</T></li>
        <li><T id="imports.dry-run-report.unchanged" values={{ count: count("skip") }}>{"{count} unchanged"}</T></li>
        <li><T id="imports.dry-run-report.with-errors" values={{ plural: plural(errors.length, "row") }}>{"{plural} with errors"}</T></li>
      </ul>
      {errors.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.rows-with-errors">Rows with errors</T></h3>
          <p className="muted"><T id="imports.dry-run-report.these-rows-are-skipped-the">These rows are skipped; the others still import.</T></p>
          <RowTable
            label="Rows with errors"
            rows={errors.map((plan) => [plan.rowNumber, plan.errors.join(" ")])}
          />
        </>
      )}
      {dropped.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.skipped-merged-or-renamed-rows">Skipped, merged or renamed rows</T></h3>
          <p className="muted">
            <T id="imports.dry-run-report.the-importer-s-row-rules" values={{ plural: plural(dropped.length, "row") }}>{"{plural} the importer's row rules left out or renamed; every other row of the file is checked below."}</T>
          </p>
          <RowTable
            label="Skipped, merged or renamed rows"
            column="Note"
            rows={dropped.map((note) => [note.rowNumber, note.text])}
          />
        </>
      )}
      {reviewed.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.to-review">To review</T></h3>
          <RowTable
            label="To review"
            column="Note"
            rows={reviewed.map((plan) => [plan.rowNumber, (plan.notes ?? []).join(" ")])}
          />
        </>
      )}
      {described.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.items">Items</T></h3>
          <RowTable
            label="Items"
            column="What the importer will do"
            rows={described.map((plan) => [
              plan.rowNumber,
              <><LabelT id="imports.dry-run-report.action" value={plan.action}>{planActionLabels[plan.action]}</LabelT>: {plan.summary}</>,
            ])}
          />
        </>
      )}
      {duplicates.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.possible-duplicates">Possible duplicates</T></h3>
          <RowTable
            label="Possible duplicates"
            rows={duplicates.map((plan) => [
              plan.rowNumber,
              <T id="imports.dry-run-report.looks-like" values={{ matches: plan.duplicates.map((match) => match.label).join(", ") }}>{"Looks like {matches}"}</T>,
            ])}
          />
        </>
      )}
      {repeated.length > 0 && (
        <>
          <h3><T id="imports.dry-run-report.repeated-in-this-file">Repeated in this file</T></h3>
          <RowTable
            label="Repeated in this file"
            rows={repeated.map((row) => [
              row.rowNumber,
              <T id="imports.dry-run-report.same-key-as-row" values={{ row: row.firstRow }}>{"Same key as row {row}; it updates that record."}</T>,
            ])}
          />
        </>
      )}
      <div className="import-actions">
        <Button
          type="button"
          disabled={!importable || busy}
          onClick={onImport}
        >
          <T id="imports.dry-run-report.import" values={{ importable: plural(importable, "row") }}>{"Import {importable}"}</T>
        </Button>
      </div>
    </Section>
  );
}

function CommitSummary({ committed }: { committed: Committed }) {
  const { log, failures } = committed;
  return (
    <Section title={<T id="imports.commit-summary.imported">Imported</T>}>
      <p role="status">
        <T id="imports.commit-summary.imported-created-updated-unchanged-failed" values={{ fileName: log.fileName, created: log.created, updated: log.updated, skipped: log.skipped, failed: log.failed }}>{"Imported {fileName}: {created} created, {updated} updated, {skipped} unchanged, {failed} failed."}</T>
      </p>
      {failures.length > 0 && (
        <RowTable
          label="Rows that failed"
          rows={failures.map((row) => [row.rowNumber, row.error ?? ""])}
        />
      )}
    </Section>
  );
}

function RowTable({
  label,
  rows,
  column = "Problem",
}: {
  label: string;
  rows: [number, ReactNode][];
  column?: string;
}) {
  return (
    <div className="table-scroll">
      <table className="stock-table" aria-label={label}>
        <thead>
          <tr>
            <th><T id="imports.row-table.row">Row</T></th>
            <th><LabelT id="imports.row-table.column" value={column}>{column}</LabelT></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([rowNumber, text], index) => (
            <tr key={`${rowNumber}-${index}`}>
              <td>{rowNumber}</td>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The import log (FLOW-47): who imported which file, when, and the row counts.
// FLOW-300: the preview's columns (Open, Date, Importer, File, New, Updated,
// Errors, By). Records are a history: Open shows one, read-only; none is deleted.
const importerLabel = (key: string, modules: ImportModuleInfo[] | undefined) =>
  modules?.find((module) => module.key === key)?.label
    ?? plannedImporters.find((planned) => planned.key === key)?.label ?? key;
function ImportLogTable({
  module,
  version = 0,
}: {
  module?: string;
  version?: number;
}) {
  // Re-keyed after each import; the previous logs stay until the new ones load.
  const logs = useResource(
    ["imports", "logs", module, version],
    () => importsApi.list(module),
    { keepPrevious: true },
  );
  const modules = useResource(["imports", "modules"], () => importsApi.modules());
  const [open, setOpen] = useState<ImportLog | null>(null);
  return (
    <Section title={<T id="imports.import-log-table.recent-imports">Recent imports</T>}>
      {logs.error ? (
        <LoadError message={logs.error} />
      ) : !logs.data ? (
        <LoadingSkeleton />
      ) : !logs.data.length ? (
        <p className="muted"><T id="imports.import-log-table.no-imports-yet">No imports yet.</T></p>
      ) : (
        <div className="table-scroll">
          <table className="stock-table" aria-label="Recent imports">
            <thead>
              <tr>
                <th><T id="imports.import-log-table.open">Open</T></th>
                <th><T id="imports.import-log-table.date">Date</T></th>
                <th><T id="imports.import-log-table.importer">Importer</T></th>
                <th><T id="imports.import-log-table.file">File</T></th>
                <th><T id="imports.import-log-table.new">New</T></th>
                <th><T id="imports.import-log-table.updated">Updated</T></th>
                <th><T id="imports.import-log-table.errors">Errors</T></th>
                <th><T id="imports.import-log-table.by">By</T></th>
              </tr>
            </thead>
            <tbody>
              {logs.data.map((log) => (
                <tr key={log.id}>
                  <td>
                    <button type="button" className="table-link" onClick={() => setOpen(log)}>
                      <T id="imports.import-log-table.open-record">Open</T>
                    </button>
                  </td>
                  <td>{dateTimeLabel(log.createdAt)}</td>
                  <td>{importerLabel(log.module, modules.data)}</td>
                  <td>{log.fileName}</td>
                  <td>{log.created}</td>
                  <td>{log.updated}</td>
                  <td>{log.failed}</td>
                  <td>{log.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ImportLogDetail log={open} importer={importerLabel(open.module, modules.data)} onClose={() => setOpen(null)} />}
    </Section>
  );
}

// One import record, read-only (FLOW-300).
function ImportLogDetail({ log, importer, onClose }: { log: ImportLog; importer: string; onClose: () => void }) {
  const rows: [ReactNode, ReactNode][] = [
    [<T id="imports.import-log-detail.importer">Importer</T>, importer],
    [<T id="imports.import-log-detail.date">Date</T>, dateTimeLabel(log.createdAt)],
    [<T id="imports.import-log-detail.by">By</T>, log.createdByName ?? "—"],
    [<T id="imports.import-log-detail.rows">Rows</T>, log.rowCount],
    [<T id="imports.import-log-detail.new">New</T>, log.created],
    [<T id="imports.import-log-detail.updated">Updated</T>, log.updated],
    [<T id="imports.import-log-detail.unchanged">Unchanged</T>, log.skipped],
    [<T id="imports.import-log-detail.errors">Errors</T>, log.failed],
    [<T id="imports.import-log-detail.status">Status</T>, log.status === "completed"
      ? <T id="imports.import-log-table.done">Done</T> : <T id="imports.import-log-table.not-finished">Not finished</T>],
  ];
  return (
    <DetailDrawer open onClose={onClose} title={log.fileName}
      description={<T id="imports.import-log-detail.read-only">Import records are kept as history and can't be edited or deleted.</T>}>
      <dl className="import-log-detail" aria-label="Import record">
        {rows.map(([label, value], index) => (
          <div key={index}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </DetailDrawer>
  );
}
