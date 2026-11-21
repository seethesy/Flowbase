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
| `GET/PUT/DELETE /api/layout/:pageKey` (`layout.edit`, Admin), audit-logged | `worker/routes/layout.ts`, `worker/records/layout.ts` |
| Page grid, edit toolbar, Hidden items, Reset page layout | `src/app/page-grid.tsx` |
| Drag-and-resize grid (lazy-loaded `react-grid-layout`) | `src/app/layout-grid-editor.tsx` |
| Style popover (text and background colors, 4.5:1 guard) | `src/app/layout-style.tsx` |
| Columns editor and layout-aware tables | `src/app/column-picker.tsx`, `src/app/table-layout.tsx`, `DataTable` |
| Field boxes on record pages | `src/app/field-card.tsx` |
| Custom cards and their builder | `src/components/custom-card.tsx`, `src/app/card-builder.tsx` |

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
- Playwright coverage: `tests/e2e/layout-coverage.spec.ts`.

## Making a page arrangeable

Wrap the page's sections in a `PageGrid` and each section in a `Block` with a
stable id (lowercase, hyphenated). Ids are saved: never rename one.

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
- At most 20 blocks and 12 custom cards per page; a card shows at most 100 rows.
- The edit chrome (toolbar, popovers, builder) is not wrapped in `<T>`, like the
  live-edit chrome in `src/app`.
