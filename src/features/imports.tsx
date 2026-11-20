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
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { readImportFile, type Sheet } from "../services/import-files";
import { importsApi } from "../services/imports";
import { LoadError } from "../components/record-display";
import { dateTimeLabel } from "./inventory-labels";
import { T } from "../app/copy";
import "./inventory.css";
import "./imports.css";

// Data import (FLOW-47): choose a CSV or XLSX file, map its columns, check the
// rows (dry run), then import them in batches of 100. The browser parses the file
// (ADR-09); the API checks and writes. Each module importer (inventory, recipes,
// leads) appears here once its ticket registers it.

export function ImportList() {
  const modules = useResource(["imports", "modules"], () => importsApi.modules());
  return (
    <>
      <PageHeader
        title={<T id="imports.import-list.imports">Imports</T>}
        subtitle={<T id="imports.import-list.bring-records-in-from-a">Bring records in from a spreadsheet. Re-running a file updates what it imported before.</T>}
      />
      <Section title={<T id="imports.import-list.importers">Importers</T>}>
        {modules.error ? (
          <LoadError message={modules.error} />
        ) : !modules.data ? (
          <LoadingSkeleton />
        ) : !modules.data.length ? (
          <p className="muted"><T id="imports.import-list.no-importers-are-available-to">No importers are available to you yet.</T></p>
        ) : (
          <ul className="import-modules">
            {modules.data.map((module) => (
              <li key={module.key}>
                <Link to={`/imports/${encodeURIComponent(module.key)}`}>
                  {module.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <ImportLogTable />
    </>
  );
}

export function ImportPage() {
  const { module: key = "" } = useParams();
  const module = useResource(["imports", "module", key], () => importsApi.module(key));
  return (
    <>
      <PageHeader
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

      {file && (
        <Section title={<T id="imports.import-flow.columns">Columns</T>}>
          <div className="import-mapping">
            {module.fields.map((field) => (
              <label className="form-field" key={field.key}>
                <span>
                  {field.label}
                  {field.required && <T id="imports.import-flow.required">{" (required)"}</T>}
                </span>
                <select
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
                </select>
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

      <ImportLogTable module={module.key} version={logVersion} />
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
              `${plan.action === "skip" ? "Unchanged" : plan.action === "update" ? "Updates" : "Creates"}: ${plan.summary}`,
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
              `Looks like ${plan.duplicates.map((match) => match.label).join(", ")}`,
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
              `Same key as row ${row.firstRow}; it updates that record.`,
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
  rows: [number, string][];
  column?: ReactNode;
}) {
  return (
    <div className="table-scroll">
      <table className="stock-table" aria-label={label}>
        <thead>
          <tr>
            <th><T id="imports.row-table.row">Row</T></th>
            <th>{column}</th>
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
                <th><T id="imports.import-log-table.when">When</T></th>
                <th><T id="imports.import-log-table.file">File</T></th>
                <th><T id="imports.import-log-table.by">By</T></th>
                <th><T id="imports.import-log-table.created">Created</T></th>
                <th><T id="imports.import-log-table.updated">Updated</T></th>
                <th><T id="imports.import-log-table.unchanged">Unchanged</T></th>
                <th><T id="imports.import-log-table.failed">Failed</T></th>
                <th><T id="imports.import-log-table.status">Status</T></th>
              </tr>
            </thead>
            <tbody>
              {logs.data.map((log) => (
                <tr key={log.id}>
                  <td>{dateTimeLabel(log.createdAt)}</td>
                  <td>{log.fileName}</td>
                  <td>{log.createdByName ?? "—"}</td>
                  <td>{log.created}</td>
                  <td>{log.updated}</td>
                  <td>{log.skipped}</td>
                  <td>{log.failed}</td>
                  <td>{log.status === "completed" ? <T id="imports.import-log-table.done">Done</T> : <T id="imports.import-log-table.not-finished">Not finished</T>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
