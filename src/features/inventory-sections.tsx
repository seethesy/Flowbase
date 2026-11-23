import { Block, PageGrid } from "../app/page-grid";
import { Dropdown } from "../components/ui/Dropdown";
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
import { LoadError } from "../components/record-display";
import "./inventory.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, LabelT } from "../app/copy";

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
        <T id="inventory-sections.section-list.all-inventory">← All inventory</T>
      </Link>
      <PageHeader
        title={<T id="inventory-sections.section-list.sections">Sections</T>}
        subtitle={<T id="inventory-sections.section-list.where-stock-lives-vendor-holds">Where stock lives. Vendor holds sub-rented items.</T>}
        eyebrow={<T id="inventory-sections.section-list.stock-supplies">{"STOCK & SUPPLIES"}</T>}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <PageGrid pageKey="inventory.sections">
      <Block id="add" name="Add section" h={5}>
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
            <FormField label={<T id="inventory-sections.section-list.new-section-name">New section name</T>}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={<T id="inventory-sections.section-list.holds">Holds</T>}>
              <Dropdown
                value={kind}
                onChange={(e) => setKind(e.target.value as SectionKind)}
              >
                {sectionKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {sectionKindLabels[option]}
                  </option>
                ))}
              </Dropdown>
            </FormField>
            <Button type="submit">
              <Plus size={14} /><T id="inventory-sections.section-list.add-section">{" Add section"}</T>
            </Button>
          </form>
        </Allowed>
      )}
      </Block>
      <Block id="filters" name="Section filters" h={3}>
      <FilterBar>
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="inventory-sections.section-list.show-archived">Show archived</T>
        </label>
      </FilterBar>
      </Block>
      <Block id="sections" name="Stock sections" h={20}>
      {sections.error ? (
        <LoadError message={sections.error} />
      ) : !sections.data ? (
        <LoadingSkeleton />
      ) : (
        sectionKindSchema.options.map((group) => (
          <Section title={<LabelT id="labels.section-kind" value={group}>{sectionKindLabels[group]}</LabelT>} key={group}>
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
                            <FormField label={<T id="inventory-sections.section-list.rename" values={{ name: section.name }}>{"Rename {name}"}</T>}>
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
                            <Button type="submit"><T id="inventory-sections.section-list.save-name">Save name</T></Button>
                          </form>
                        ) : (
                          section.name
                        )}
                      </td>
                      <td>
                        <T id="inventory-sections.section-list.in-stock" values={{ Number: Number(section.totalQuantity.toFixed(4)) }}>{"{Number} in stock"}</T>
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
                              <T id="inventory-sections.section-list.restore" values={{ name: section.name }}>{"Restore {name}"}</T>
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
                                <T id="inventory-sections.section-list.rename" values={{ name: section.name }}>{"Rename {name}"}</T>
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
                                <T id="inventory-sections.section-list.archive" values={{ name: section.name }}>{"Archive {name}"}</T>
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
      </Block>
      </PageGrid>
    </>
  );
}
