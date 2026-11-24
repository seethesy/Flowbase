# Page layouts (FLOW-253 to 256)

The Admin's live edit (FLOW-240) also changes page **layout**: blocks on the
page grid (rows and columns sized as shares, with merged areas; FLOW-319 to
322), table columns, field boxes and custom cards. There is one layout
per page, shared by everyone, saved by the same pencil → Save/Cancel session as
wording. With no saved layout a page renders exactly as its code does.

## Pieces

| Piece | Where |
| --- | --- |
| Field registry: every field a layout may show, per source, with its read rule | `shared/fields/` |
| `LayoutDoc` schema, limits, contrast check, server validation (`layoutProblems`) | `shared/layout.ts` |
| Page grid: track math, editing operations, v1 conversion, grid invariants (`gridProblems`) | `shared/page-grid.ts` |
| `fields=` projection and card queries (`where`, `orderBy`, `take`) | `worker/fields.ts`; card filters, sort and limit in the list's own SQL query (FLOW-308) in `worker/card-sql.ts` |
| `GET/PUT/DELETE /api/layout/:pageKey` (`layout.edit`, Admin), audit-logged | `worker/routes/settings/layout.ts`, `worker/records/settings/layout.ts` |
| Page grid in view mode and its sizing frame (`useGridFrame`) | `src/app/live-edit/page-grid.tsx` |
| Page grid editor: guides, dividers, tracks, merge, placement, toolbar, Hidden items, Reset page layout | `src/app/live-edit/page-grid-editor.tsx` |
| Drag-and-resize grid for boxes inside cards and field cards (lazy-loaded `react-grid-layout`) | `src/app/live-edit/layout-grid-editor.tsx` |
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

- Every main screen is on the grid: Calendar, Tasks (dashboard, all
  tasks, templates), Recipes and recipe books, SOPs, Sales (tracker and
  reports), the Proposals library, Approval queue, Lead dashboard, Production, Master inventory, Order
  lists, Kitchen orders, Stock counts, Time tracking, Operational reports,
  Imports, Settings, Usage, Operations and Users. Search (a dialog) and
  Notifications (a section of the profile page) are not pages.
- The event closeout tab has its own grid (`events.closeout`) inside the event's
  Closeout section: its blocks keep their saved place whatever the event page's
  layout is. A drag that starts in a nested grid (a tab's blocks, a card's
  boxes) moves only the nested item.
- Size without dragging: each block's bar had width presets (¼, ⅓, ½, ⅔, Full),
  "Fit content" (`fit`) and "Hide on phone" (`hidePhone`), and a focused block
  moved with the arrow keys. Since FLOW-321 page blocks use the page grid
  instead and keep only "Hide on phone"; boxes inside cards and field cards keep
  the presets and arrow keys (`src/app/live-edit/layout-sizes.ts`).
- Style popover: presets (Plain, Card, Highlight, Warning), "Default look",
  text and background colors, no border or a border color, an accent stripe,
  corners, padding, title size and "Hide title bar". The 4.5:1 text/background
  check applies to every combination, presets included.
- Phones keep the page grid's arrangement and shares (FLOW-320; no stacking)
  and drop blocks set to hide on phone, leaving their cells empty. Boxes inside
  cards still stack below 900px.
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
- `h` sets the block's row share in the code default grid (one column, a row
  per block, shares proportional to `h`); `w` no longer matters.
- A block that is sometimes absent (`{cond && <Block …>}`, another tab, a role
  that can't see it) keeps its saved cell; while it's absent, a row or column
  holding only absent blocks collapses (FLOW-320 A3).

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
- At most 40 blocks and 12 custom cards per page; a page grid has 1 to 12
  columns and 1 to 40 rows; a card shows at most 100 rows.
- A card costs one list query (FLOW-308). The list endpoint runs it as the viewer,
  with its own row scope, and adds the card's filters, sort and `LIMIT take` in
  SQL when every filter and the sort are on plain columns of the source's table
  (`cardColumns` in `worker/card-sql.ts`). A filter or sort on a computed field,
  or on one with a read rule (hidden from some viewers), runs in memory on one
  page of at most 500 rows; related-record lists always do. The card is then
  applied again in memory on fields the viewer may read, so a hidden field filters
  and sorts as empty either way.
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

## Page grid (FLOW-319 to 322)

A saved layout is a `LayoutDoc` version 2: `grid.cols` and `grid.rows` are
shares in basis points (1% = 100, each axis exactly 10000, every track at least
1%), and `grid.regions` are merged rectangles of two or more cells that never
overlap. Each shown block's `x`, `y`, `w`, `h` are track coordinates: a single
cell, or exactly a merged area (addressed by its top-left cell); two shown
blocks never share one. Hidden and deleted blocks keep their last place only as
a restore hint; a permanently removed block has none. `gridProblems`
(`shared/page-grid.ts`) checks all of this for the client schema and for
`PUT /api/layout`, whose 400 names the offending path.

- **Saved version 1 layouts** convert on read (`convertV1`), on the server
  (`getLayout`) and in the client schema: column edges at the shown blocks' left
  and right edges, row edges at their tops and bottoms, gaps as empty cells, a
  block overlapping an earlier one in a new row at the bottom; Fit content is
  dropped. The first Save writes version 2; `PUT` refuses version 1. Reset
  page layout still deletes the row, so the page renders natively again.
- **Code default** in edit mode: one column, a row per built-in block, shares
  from their `h`. A built-in added to the code after a save goes into a new
  row spanning every column, above the row where the next built-in in code
  order starts (or at the bottom). A built-in the code dropped isn't sent by
  `GET /api/layout` (the key manifest says which exist): its cell stays empty.
- **Track math**: dragging a divider changes only its two tracks; an exact
  percentage rescales the others proportionally (to the nearest 0.1% when that
  totals exactly) and is refused if a track would go under 1%; a new track gets
  1/(n+1); a removed track's share goes to the others; rounding goes by largest
  remainder.
- **Operations** (each returns the next document and an outcome to preview, or
  a refusal with no change): move (onto an occupied cell: swap), merge (refused
  with several blocks inside, naming them), unmerge (its block to the top-left
  cell), add and remove a row or column (a merged area spanning the point grows
  or shrinks; removing a track a block sits entirely in is refused), add a block
  into an empty cell or a new row at the bottom (straight there when the page
  has no empty cell), restore to the last place when it's free, else to the
  cell the Admin picks.
- **View mode** (`page-grid.tsx`): the grid fills the usable area, the content
  width and the viewport below the grid's top less the main area's bottom
  padding, with a 480px floor below which the page scrolls (the grid also grows
  so that no row is under 56px, for pages with many rows); a grid nested in
  another grid's cell fills that cell. Tracks are `minmax(0, <share>fr)`, so
  each is (usable size − gaps) × share at every width, phones included. Content
  larger than its cell scrolls inside it. No guides or controls render.
- **Edit mode** (`page-grid-editor.tsx`) draws in the same frame (edit and view
  boxes match): the toolbar is fixed to the bottom of the screen (a nested
  grid's follows its frame in its cell) and the guides are overlaid. Every boundary is a dotted
  blue divider (`role="separator"`, `aria-valuenow` the percentage; arrow keys
  1%, Shift 5%; drag shows both percentages); every empty cell and merged area
  is outlined. Each track's label has its exact percentage and add and remove
  buttons. Cells are focusable: the arrow keys move between them, Shift and
  the arrow keys (or Shift and click) select a rectangle for Merge and Unmerge.
  A block moves by its handle, the one destination highlighted, or with Enter,
  the arrow keys and Enter. Add card and Add text ask for an empty cell or "New
  row at bottom"; Show and Restore use the last place or ask the same way.
  Every edit shows its outcome first (the grid draws it, with a line of text,
  also announced); Esc cancels.
- Playwright coverage: `tests/e2e/settings/page-grid-render.spec.ts`,
  `page-grid-editor.spec.ts` and `page-grid-cross-device.spec.ts`; model tests
  in `tests/settings/page-grid.test.ts`.
