import { LayoutHeader } from "../app/live-edit/layout-deletion";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "../app/queryClient";
import { canReadField, fieldRegistry, type SourceKey } from "../../shared/fields";
import type { CardConfig } from "../../shared/layout";
import { T } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { cardRequestPath, cardsApi } from "../services/layout";
import { BoxesView } from "./layout-boxes";
import { FieldLabel, FieldValue } from "./layout-fields";
import { LoadError } from "./record-display";

// A custom card (FLOW-256): a title, a source (this record, a related list or a
// main list), and a table or boxes. The config is the same for everyone; the
// rows and fields come from the source's own API as the viewer, one request per
// card, so each viewer sees only what their role may.

type Record_ = { source: SourceKey; id: string } | null;

// The card's source and the related list's endpoint, or null when the card
// can't load on this page (a "This record" card off a record page).
export function cardTarget(card: CardConfig, record: Record_): { source: SourceKey; relationPath: string | null } | null {
  if (card.source.type === "list") return { source: card.source.list, relationPath: null };
  if (!record) return null;
  if (card.source.type === "record") return { source: record.source, relationPath: null };
  const relationKey = card.source.relation;
  const relation = fieldRegistry[record.source].relations?.find((r) => r.key === relationKey);
  return relation ? { source: relation.source, relationPath: relation.path(record.id) } : null;
}

export function CustomCard({ card, cardId, record }: { card: CardConfig; cardId: string; record: Record_ }) {
  const { actor } = usePermissions();
  const target = cardTarget(card, record);
  const path = target ? cardRequestPath(card, target.source, record?.id ?? null, target.relationPath) : null;
  const rows = useQuery({
    queryKey: ["layout-card", cardId, path],
    queryFn: () => cardsApi.rows(path!, card.source.type === "record"),
    enabled: path !== null,
  }, queryClient);
  const source = target?.source;
  return (
    <section className="panel layout-card" data-card-id={cardId}>
      <LayoutHeader headerKey={`${cardId}.title`} name={`${card.title} header`}>
      <div className="section-heading">
        <h2>{card.title}</h2>
      </div>
      </LayoutHeader>
      {!source || !path ? (
        <p className="muted">
          <T id="layout.custom-card.no-data">No data</T>
        </p>
      ) : rows.error ? (
        <LoadError message={(rows.error as Error).message} />
      ) : !rows.data ? (
        <div className="skeleton" role="status" aria-label="Loading card" />
      ) : !rows.data.length ? (
        <p className="muted">
          <T id="layout.custom-card.no-data">No data</T>
        </p>
      ) : card.display.type === "table" ? (
        <div className="table-scroll layout-card-scroll">
          <table>
            <thead>
              <tr>
                {card.display.columns
                  .filter((column) => actor !== null && canReadField(actor, source, column.key))
                  .map((column) => (
                    <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                      <FieldLabel source={source} field={column.key} />
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row, index) => {
                const href = fieldRegistry[source].recordRoute(row);
                return (
                  <tr key={typeof row.id === "string" ? row.id : index}>
                    {card.display.type === "table" &&
                      card.display.columns
                        .filter((column) => actor !== null && canReadField(actor, source, column.key))
                        .map((column, i) => (
                          <td key={column.key}>
                            {i === 0 && href ? (
                              <Link to={href}>
                                <FieldValue source={source} field={column.key} row={row} />
                              </Link>
                            ) : (
                              <FieldValue source={source} field={column.key} row={row} />
                            )}
                          </td>
                        ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="layout-card-scroll">
          {rows.data.map((row, index) => {
            const href = card.source.type === "record" ? null : fieldRegistry[source].recordRoute(row);
            return (
              <div key={typeof row.id === "string" ? row.id : index} className="layout-card-row">
                {card.display.type === "boxes" && <BoxesView boxes={card.display.boxes} source={source} row={row} />}
                {href && (
                  <Link to={href} className="layout-card-open">
                    <T id="layout.custom-card.open">Open</T>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
