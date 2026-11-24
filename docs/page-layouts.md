# Page layouts (FLOW-253 to 256)

The Admin's live edit (FLOW-240) also changes page **layout**: blocks on a
12-column grid, table columns, field boxes and custom cards. There is one layout
per page, shared by everyone, saved by the same pencil → Save/Cancel session as
wording. With no saved layout a page renders exactly as its code does.

## Pieces

| Piece | Where |
| --- | --- |
| Field registry: every field a layout may show, per source, with its read rule | `shared/fields/` |
| `LayoutDoc` schema, limits, contrast check, server validation (`layoutProblems`) | `shared/layout.ts` |
| `fields=` projection and card queries (`where`, `orderBy`, `take`) | `worker/fields.ts` |
| `GET/PUT/DELETE /api/layout/:pageKey` (`layout.edit`, Admin), audit-logged | `worker/routes/settings/layout.ts`, `worker/records/settings/layout.ts` |
| Page grid, edit toolbar, Hidden items, Reset page layout | `src/app/live-edit/page-grid.tsx` |
| Drag-and-resize grid (lazy-loaded `react-grid-layout`) | `src/app/live-edit/layout-grid-editor.tsx` |
| Style popover (text and background colors, 4.5:1 guard) | `src/app/live-edit/layout-style.tsx` |
| Columns editor and layout-aware tables | `src/app/live-edit/column-picker.tsx`, `src/app/live-edit/table-layout.tsx`, `DataTable` |
| Field boxes on record pages | `src/app/live-edit/field-card.tsx` |
| Custom cards and their builder | `src/components/custom-card.tsx`, `src/app/live-edit/card-builder.tsx` |

## Added in FLOW-273

- Record pages on the grid: client (Overview tab), venue, vendor, staff and
  inventory item, each with a field card (`client-facts`, `venue-facts`,
  `vendor-facts`, `staff-facts`, `item-facts`). Other sections of those pages are
  not blocks yet.
- Column width: in edit mode every layout-aware table header has a drag handle
  (`role=separator`, also the left and right arrow keys, 10px a step); the width
  is saved with the table's columns (`columns[].width`, 40 to 1200).
- Edit mode matches added boxes: a field added as a box on the lead page gets an
  Edit input (Guests, `guestCount`, which `PUT /api/leads/:id` now accepts). Hiding a
  box only hides it; stored data is never changed.
- The Style popover also styles each box in a custom card's Boxes display.

## Added in FLOW-274

- Every section of the client (each tab), venue, vendor, staff and inventory item
  pages is a `Block`; a tab's block keeps its saved place while another tab shows.
- Proposals have a field card (`proposals.detail`, `proposal-facts`) around the
  facts at the top of a proposal's drawer.
- The record's Edit form hides an optional field whose box was hidden (client
  notes; venue address, jurisdiction and notes; vendor ordering fields; item code,
  group and description; staff phone). Creating a record always shows every field.
- Playwright coverage: `tests/e2e/settings/layout-coverage.spec.ts`.

## Added in FLOW-278

- Every main screen is on the grid: Calendar, Day-of, Tasks (dashboard, all
  tasks, templates), Recipes and recipe books, SOPs, Sales (tracker and
  reports), the Proposals library, Approval queue, Lead dashboard, Production, Master inventory, Order
  lists, Kitchen orders, Stock counts, Time tracking, Operational reports,
  Imports, Settings, Usage, Operations and Users. Search (a dialog) and
  Notifications (a section of the profile page) are not pages.
- The event closeout tab has its own grid (`events.closeout`) inside the event's
  Closeout section: its blocks keep their saved place whatever the event page's
  layout is. A drag that starts in a nested grid (a tab's blocks, a card's
  boxes) moves only the nested item.
- Size without dragging: each block's bar has width presets (¼, ⅓, ½, ⅔, Full),
  "Fit content" (`fit`: the height follows what the card shows) and "Hide on
  phone" (`hidePhone`). A focused block or box moves with the arrow keys and
  resizes with Shift and the arrow keys (`src/app/live-edit/layout-sizes.ts`).
- Style popover: presets (Plain, Card, Highlight, Warning), "Default look",
  text and background colors, no border or a border color, an accent stripe,
  corners, padding, title size and "Hide title bar". The 4.5:1 text/background
  check applies to every combination, presets included.
- Phones (under 900px) stack blocks in saved reading order, one column, and
  drop blocks set to hide on phone.
- A record page's toolbar says the layout applies to every record of that type.
- A page holds up to 40 blocks.
- Playwright coverage: `tests/e2e/settings/layout-every-screen.spec.ts`.

## Added in FLOW-279

- Built-in cards that list records can be edited in place: a pencil on the
  block opens the card builder with the card's current setup, title and source
  locked. Saving stores `data` (filters, sort, rows, columns or boxes) on the
  builtin block; the card then renders through the custom-card path with
  `fields=`, so a viewer only gets fields their role can read. "Reset card"
  drops `data` and the code's card comes back. Editable cards and their code
  defaults are listed in `builtinCards` (`shared/layout.ts`), keyed
  `<pageKey>/<blockId>`, so the server checks the override's fields: Dashboard
  My Leads and Upcoming Events, and a client's Events. An edited card's title
  is the card's own name, not a wording key.
- Layout-aware tables added: master inventory, ingredients and supplies, bar
  and low stock (`layoutTables`). Ingredients and supplies share one page
  layout (`inventory.consumables`); bar is `inventory.bar`, low stock
  `inventory.low-stock`.
- Switching a custom card's source keeps the columns, boxes, filters and sort
  whose field the new source has, and names the ones it dropped.
- Playwright coverage: `tests/e2e/settings/layout-builtin-cards.spec.ts`.

## Navigation by role (FLOW-284)

- An Admin chooses which roles see each sidebar heading and tab: Settings ›
  Roles & permissions › Navigation, or the "Who sees this" eye beside a heading
  or tab in live edit (saved with the live-edit Save). Both read and write the
  same setting.
- Stored per role as a list of hidden nav keys in `role_nav_hidden`
  (`GET /api/permissions/navigation` for everyone signed in, `PUT` Admin only,
  audit-logged). A heading's key is its `copyId` (`sales`); a tab's is
  `<heading copyId>.<tab copyId>` (`sales.venues`). Keys come from copyIds, so
  renaming a tab in live edit keeps the setting. Every key is listed under
  `nav` in `shared/generated/live-edit-keys.json`, and the API refuses others.
- It only narrows: a role sees a tab only if it isn't hidden **and** its own
  rule passes (area permission or `visible`). Hiding a heading hides every tab
  under it, and a heading with no visible tab is hidden. Admin always sees
  everything.
- The sidebar, the tab bar, the breadcrumb and the landing page all follow it.
  A direct link to a hidden page shows "Not available for your role" with a link
  to the role's first visible page; `/` goes to that page when the Dashboard's
  Overview is hidden.
- **Not a security boundary.** The API still answers by area permissions only.

## Making a page arrangeable

Wrap the page's sections in a `PageGrid` and each section in a `Block` with a
stable id (lowercase, hyphenated). Ids are saved: renaming one needs an entry
in `shared/live-edit-renames.ts` (FLOW-277, see `docs/live-text-editing.md`),
and `npm run live-edit:keys` must be run after adding a block. A block whose id
isn't a literal (built from a list) needs the full list in the PageGrid's
`blockIds` prop. Error and loading messages go outside the `PageGrid` or inside
a `Block`: with a saved layout only blocks render.

```tsx
<PageGrid pageKey="leads.detail" record={{ source: "leads", id: lead.id, row: lead }}>
  <Block id="notes" name="Notes" w={6} h={10}>
    <Section title={<T id="lead-detail.notes.title">Notes</T>}>…</Section>
  </Block>
</PageGrid>
```

- `pageKey` names the saved layout (`area.screen`). `record` makes "This record"
  and related-list cards available.
- `w`/`h` are the block's default size in edit mode (12 columns; rows of 24px).
- A block that is sometimes absent (`{cond && <Block …>}`) keeps its saved
  place and comes back there.

A built-in card becomes editable when its `pageKey/blockId` has an entry in
`builtinCards` (its code default as a card config). Only record lists qualify:
notes, files, photos, floor plans, communications and planning keep Style,
Hide and move only.

A table becomes layout-aware when its `DataTable` `copyKey` is listed in
`layoutTables` (`shared/layout.ts`) and it sits inside a `PageGrid`. List its
locked row controls and its code-only columns (columns that aren't registry
fields) there. Field boxes: wrap the record's facts in a `FieldCard` and list
its key under `recordPages`. `useShownFields` tells the record's Edit form which
optional fields to show.

## Rules

- Layouts never change permissions or data. Viewers get only fields their role
  may read: tables drop the column, field cards drop the box, and `fields=`
  drops the value.
- Admin-entered text is plain text; colors are 6-digit hex only, checked for
  4.5:1 contrast on the client and the server.
- A dashboard or custom card can limit itself to some roles with `visibleTo`
  (FLOW-269): set from its Style popover or Settings › Roles & permissions. It
  also hides from a role that can't read the card's source area.
- At most 40 blocks and 12 custom cards per page; a card shows at most 100 rows.
- The edit chrome (toolbar, popovers, builder) is not wrapped in `<T>`, like the
  live-edit chrome in `src/app`.

## Added in FLOW-280

- Event BEO, staff, trucks, payments, preparation, timeline and activity have
  independent section grids (`events.beo`, `events.staff`, `events.trucks`,
  `events.payments`, `events.preparation`, `events.timeline`, `events.activity`).
  Existing lists, timeline and BEO areas keep their own controls. Errors and
  drawers remain outside the inner grids.
- Staff and Inventory filters are separate blocks. The table retains `list`,
  including when loading or reporting an error, so existing saved layouts work.
- Browser coverage: `tests/e2e/settings/layout-event-tabs.spec.ts`.

## Added in FLOW-281

- In-place card editing also covers Dashboard Working Staff, client Proposal
  tracker, vendor Items they supply and venue Event history. Working Staff uses
  the dashboard's currently working shifts and original event visibility rules.
  Related lists retain their parent scope and the viewer's permissions.
- Recipes and SOP library tables choose and reorder columns, save widths and
  export the visible columns. SOP procedure content is never a layout field.
- Lead dashboard and time-report aggregate tables remain code-only: their rows
  combine different measures and are not individual registry records.
- Confirmed exclusions: `clients.client-detail` is a tab copy key, not a table;
  the legacy `proposals.tsx` component is unrouted. Staff shifts and item events
  cards do not exist on those detail pages and are excluded by the developer.
  Existing inventory planning holds/allocations keep their organizers.

## Added in FLOW-283

- SOP detail and creation use `sops.detail`: `sop-header-facts`, `procedure`,
  `edit-history` and attachments. Category/version can be removed independently;
  procedure content remains record data, edited only through Edit SOP.
- Newly covered pages: Documents, notification preferences on Profile, task
  detail, Archived, Collector health, inventory categories and sections, recipe
  detail, order detail, stock counting, import detail, Roles & permissions,
  coming-soon pages, placeholders and the newly merged photo gallery pages. Existing inventory planning and history
  blocks were verified; legacy unrouted Proposals is excluded by agreement.
- Documents' DataTable is layout-aware. SOP library column support is FLOW-281;
  FLOW-283 verifies it rather than adding a second implementation. Remaining
  inventory planning/history tables are plain HTML and keep their organizers.
- `tests/settings/page-layout-coverage.test.ts` follows every router component through
  local imports and re-exports, and rejects a route with no PageGrid. Printable,
  sign-in and offline BEO pages are exempt. Redirects do not render pages.
- Browser coverage: `tests/e2e/settings/layout-remaining-pages.spec.ts`; inventory coverage
  continues in `tests/e2e/settings/layout-coverage.spec.ts`.

## Added in FLOW-282

- Delete is separate from Hide. Blocks, field boxes, free text, section headers,
  page subtitles and layout-aware tables can be deleted with a named confirmation.
  The page title stays. A table can disappear independently of its containing block.
- Deleted items shows the name, kind, deleting user id and time. Restore preserves
  position, size, style and role visibility. Save shares changes; Cancel discards
  the entire pending layout edit. Only Admin (`layout.edit`) sees these controls.
- Permanent removal physically removes custom cards/text/inner text. Built-in
  blocks, field boxes, headers and tables retain tombstones; only Reset page layout
  brings them back. Reset's confirmation explains this. Deleted items do not count
  toward the 40 active blocks or 12 active custom cards.
- Deleted field boxes suppress optional fields in record Edit forms; required
  record inputs remain available. Stored record values, SOP content and table data
  never change. Deleted cards leave Roles & permissions; restoring retains roles.
- Layout audit snapshots include explicit delete/restore/permanent-delete actions.
- Coverage: `tests/settings/layout-deletion.test.ts`, `tests/e2e/settings/layout-deletion.spec.ts`,
  and the SOP lifecycle checks in `tests/e2e/settings/layout-remaining-pages.spec.ts`.

Integration with main preserves FLOW-296 aggregate column resizing (no registry field chooser), FLOW-266 inventory filters and shortcuts, and the Documents `documents-table` id.
