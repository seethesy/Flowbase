import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  sectionKindLabels,
  sectionKindSchema,
  type SectionKind,
} from "../../shared/inventory";
import { sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import {
  PageHeader,
  Button,
  FilterBar,
  Section,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "./clients";
import "./inventory.css";

// Sections (FLOW-70): Admin adds, renames and archives them.
export function SectionList() {
  const [archived, setArchived] = useState(false);
  const sections = useResource(
    ["sections", { archived }],
    () => sectionsApi.list({ archived }),
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SectionKind>("rental");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      sections.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Link to="/inventory" className="back-link">
        ← All inventory
      </Link>
      <PageHeader
        title="Sections"
        subtitle="Where stock lives. Vendor holds sub-rented items."
        eyebrow="STOCK & SUPPLIES"
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!archived && (
        <Allowed action="inventory.sections">
          <form
            className="inline-row"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setError("Name is required.");
              void run(async () => {
                await sectionsApi.create({ name, kind });
                setName("");
              });
            }}
          >
            <FormField label="New section name">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Holds">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as SectionKind)}
              >
                {sectionKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {sectionKindLabels[option]}
                  </option>
                ))}
              </select>
            </FormField>
            <Button type="submit">
              <Plus size={14} /> Add section
            </Button>
          </form>
        </Allowed>
      )}
      <FilterBar>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </FilterBar>
      {sections.error ? (
        <LoadError message={sections.error} />
      ) : !sections.data ? (
        <LoadingSkeleton />
      ) : (
        sectionKindSchema.options.map((group) => (
          <Section title={sectionKindLabels[group]} key={group}>
            <table className="stock-table">
              <tbody>
                {sections.data
                  ?.filter((section) => section.kind === group)
                  .map((section) => (
                    <tr key={section.id}>
                      <td>
                        {renaming?.id === section.id ? (
                          <form
                            className="inline-row"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void run(async () => {
                                await sectionsApi.rename(
                                  section.id,
                                  renaming.name,
                                );
                                setRenaming(null);
                              });
                            }}
                          >
                            <FormField label={`Rename ${section.name}`}>
                              <input
                                autoFocus
                                value={renaming.name}
                                onChange={(e) =>
                                  setRenaming({
                                    id: section.id,
                                    name: e.target.value,
                                  })
                                }
                              />
                            </FormField>
                            <Button type="submit">Save name</Button>
                          </form>
                        ) : (
                          section.name
                        )}
                      </td>
                      <td>
                        {Number(section.totalQuantity.toFixed(4))} in stock
                      </td>
                      <td>
                        {archived ? (
                          <Allowed action="inventory.sections">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                run(() =>
                                  sectionsApi.setArchived(section.id, false),
                                )
                              }
                            >
                              Restore {section.name}
                            </Button>
                          </Allowed>
                        ) : (
                          <>
                            <Allowed action="inventory.sections">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setRenaming({
                                    id: section.id,
                                    name: section.name,
                                  })
                                }
                              >
                                Rename {section.name}
                              </Button>
                            </Allowed>
                            <Allowed action="inventory.sections">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  run(() =>
                                    sectionsApi.setArchived(section.id, true),
                                  )
                                }
                              >
                                Archive {section.name}
                              </Button>
                            </Allowed>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
        ))
      )}
    </>
  );
}
