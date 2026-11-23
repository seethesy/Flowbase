import { Block, PageGrid } from "../app/page-grid";
import { Dropdown } from "../components/ui/Dropdown";
import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
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

// Settings › Locations (FLOW-70, FLOW-289 AC4): where stock lives, and the
// kitchen's storage areas. Admin adds, renames, reorders and archives them; a
// location that still holds stock can't be archived.
export function LocationsPage() {
  const [archived, setArchived] = useState(false);
  const sections = useResource(
    ["sections", { archived }],
    () => sectionsApi.list({ archived }),
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SectionKind>("location");
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
      <Link to="/settings" className="back-link">
        <T id="inventory-sections.locations-page.settings">← Settings</T>
      </Link>
      <PageHeader pageKey="inventory.sections"
        title={<T id="inventory-sections.locations-page.locations">Locations</T>}
        subtitle={<T id="inventory-sections.locations-page.where-stock-lives-vendor-holds">Where stock lives. Vendor holds sub-rented items; the kitchen keeps ingredients in its own storage.</T>}
        eyebrow={<T id="inventory-sections.locations-page.settings-eyebrow">SETTINGS</T>}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <PageGrid pageKey="inventory.sections">
      <Block id="add" name="Add location" h={5}>
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
            <FormField label={<T id="inventory-sections.locations-page.new-location-name">New location name</T>}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={<T id="inventory-sections.locations-page.list">List</T>}>
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
              <Plus size={14} /><T id="inventory-sections.locations-page.add-location">{" Add location"}</T>
            </Button>
          </form>
        </Allowed>
      )}
      </Block>
      <Block id="filters" name="Location filters" h={3}>
      <FilterBar>
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="inventory-sections.locations-page.show-archived">Show archived</T>
        </label>
      </FilterBar>
      </Block>
      <Block id="sections" name="Locations" h={20}>
      {sections.error ? (
        <LoadError message={sections.error} />
      ) : !sections.data ? (
        <LoadingSkeleton />
      ) : (
        sectionKindSchema.options.map((group) => {
          const rows = (sections.data ?? []).filter((section) => section.kind === group);
          // Moves one row up or down and saves the whole list's order.
          const move = (index: number, by: number) => {
            const ids = rows.map((row) => row.id);
            [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
            void run(() => sectionsApi.reorder(group, ids));
          };
          return (
          <Section title={<LabelT id="labels.section-kind" value={group}>{sectionKindLabels[group]}</LabelT>} key={group}>
            <table className="stock-table">
              <tbody>
                {rows.map((section, index) => (
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
                            <FormField label={<T id="inventory-sections.locations-page.rename" values={{ name: section.name }}>{"Rename {name}"}</T>}>
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
                            <Button type="submit"><T id="inventory-sections.locations-page.save-name">Save name</T></Button>
                          </form>
                        ) : (
                          section.name
                        )}
                      </td>
                      <td>
                        <T id="inventory-sections.locations-page.in-stock" values={{ Number: Number(section.totalQuantity.toFixed(4)) }}>{"{Number} in stock"}</T>
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
                              <T id="inventory-sections.locations-page.restore" values={{ name: section.name }}>{"Restore {name}"}</T>
                            </Button>
                          </Allowed>
                        ) : (
                          <>
                            <Allowed action="inventory.sections">
                              <Button variant="ghost" disabled={index === 0} aria-label={`Move ${section.name} up`}
                                onClick={() => move(index, -1)}>
                                <ArrowUp size={14} />
                              </Button>
                              <Button variant="ghost" disabled={index === rows.length - 1} aria-label={`Move ${section.name} down`}
                                onClick={() => move(index, 1)}>
                                <ArrowDown size={14} />
                              </Button>
                            </Allowed>
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
                                <T id="inventory-sections.locations-page.rename" values={{ name: section.name }}>{"Rename {name}"}</T>
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
                                <T id="inventory-sections.locations-page.archive" values={{ name: section.name }}>{"Archive {name}"}</T>
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
          );
        })
      )}
      </Block>
      </PageGrid>
    </>
  );
}
