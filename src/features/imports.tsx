import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  applyTransforms,
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
import { LoadError } from "./clients";
import { dateTimeLabel } from "./inventory-labels";
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
        title="Imports"
        subtitle="Bring records in from a spreadsheet. Re-running a file updates what it imported before."
      />
      <Section title="Importers">
        {modules.error ? (
          <LoadError message={modules.error} />
        ) : !modules.data ? (
          <LoadingSkeleton />
        ) : !modules.data.length ? (
          <p className="muted">No importers are available to you yet.</p>
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
        eyebrow="Imports"
        title={module.data ? `Import ${module.data.label}` : "Import"}
        subtitle="Choose a CSV or Excel (.xlsx) file. Nothing is saved until you import."
      >
        <Button asChild variant="outline">
          <Link to="/imports">All imports</Link>
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
  const rows = useMemo(
    () =>
      file
        ? applyTransforms(mapRows(file.sheet, mapping), module.transforms)
        : [],
    [file, mapping, module.transforms],
  );
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
      <Section title="File">
        <label className="form-field">
          <span>File</span>
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
            {file.name}: {plural(rows.length, "row")} to import.
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </Section>

      {file && (
        <Section title="Columns">
          <div className="import-mapping">
            {module.fields.map((field) => (
              <label className="form-field" key={field.key}>
                <span>
                  {field.label}
                  {field.required && " (required)"}
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
              Choose a column for {missing.map((field) => field.label).join(", ")}.
            </p>
          )}
          <div className="import-actions">
            <Button
              type="button"
              disabled={!rows.length || missing.length > 0 || Boolean(busy)}
              onClick={() => void check()}
            >
              Check rows
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
  busy,
  onImport,
}: {
  plans: ImportRowPlan[];
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
  return (
    <Section title="Dry run">
      <ul className="import-summary" aria-label="Dry run summary">
        <li>{count("create")} to create</li>
        <li>{count("update")} to update</li>
        <li>{count("skip")} unchanged</li>
        <li>{plural(errors.length, "row")} with errors</li>
      </ul>
      {errors.length > 0 && (
        <>
          <h3>Rows with errors</h3>
          <p className="muted">These rows are skipped; the others still import.</p>
          <RowTable
            label="Rows with errors"
            rows={errors.map((plan) => [plan.rowNumber, plan.errors.join(" ")])}
          />
        </>
      )}
      {duplicates.length > 0 && (
        <>
          <h3>Possible duplicates</h3>
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
          <h3>Repeated in this file</h3>
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
          Import {plural(importable, "row")}
        </Button>
      </div>
    </Section>
  );
}

function CommitSummary({ committed }: { committed: Committed }) {
  const { log, failures } = committed;
  return (
    <Section title="Imported">
      <p role="status">
        Imported {log.fileName}: {log.created} created, {log.updated} updated,{" "}
        {log.skipped} unchanged, {log.failed} failed.
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
}: {
  label: string;
  rows: [number, string][];
}) {
  return (
    <div className="table-scroll">
      <table className="stock-table" aria-label={label}>
        <thead>
          <tr>
            <th>Row</th>
            <th>Problem</th>
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
    <Section title="Recent imports">
      {logs.error ? (
        <LoadError message={logs.error} />
      ) : !logs.data ? (
        <LoadingSkeleton />
      ) : !logs.data.length ? (
        <p className="muted">No imports yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="stock-table" aria-label="Recent imports">
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>By</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Unchanged</th>
                <th>Failed</th>
                <th>Status</th>
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
                  <td>{log.status === "completed" ? "Done" : "Not finished"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
