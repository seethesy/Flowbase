# Live text editing

The Admin can change the app's built-in wording (headings, labels, button text,
help text, empty states) on screen, without a code change (FLOW-240). This page is
for anyone adding or changing screen text.

## How it works

- Every built-in string on a screen is a `<T id="…">Default text</T>` from
  `src/app/copy.tsx`. The text in code is the default.
- The Admin's saved wording is a row in `ui_copy`, keyed by the same id.
  `GET /api/copy` returns every override; `PUT /api/copy` saves a batch in one
  transaction; `DELETE /api/copy/:key` resets one key to its default. Saving needs
  `copy.edit` (Admin only). Overrides render as text, never HTML.
- In the header, the Admin's pencil turns on edit mode: every string gets a dashed
  outline, a click opens an inline editor (a click on text inside a button or link
  edits it and doesn't press it), a dot marks strings that differ from their
  default, and **Save** / **Cancel** replace the pencil. Leaving a page with unsaved
  edits asks Save, Discard or Stay. Saved wording shows for everyone at once.

Out of scope: record data, print and PDF documents (`/print/*`,
`src/components/print`, `print-sample`, `beo-print`, `offline-beos`, recipe print
views), toasts, form validation and error messages, aria-labels, `title` tooltips,
native `<option>` labels and server-generated text (notification messages).

## Writing screen text

```tsx
<h2><T id="leads.inbox.heading">New leads</T></h2>
<T id="leads.inbox.count" values={{ count }}>{"{count} leads match"}</T>
<Plural id="leads.inbox.rows" count={rows} one="{count} row" other="{count} rows" />
```

- Live values go in `{placeholders}`, filled from `values` (text or elements).
  Never build a sentence by concatenating strings around `<T>`: the Admin edits the
  whole sentence. The editor refuses an edit that drops, misspells or adds a
  placeholder, and so does the Worker.
- Plurals are two keys, `<id>.one` and `<id>.other`, through `<Plural>`.
- A prop that shows text takes `ReactNode`, so the caller passes
  `title={<T id="…">Venues</T>}`. Props also used for an `aria-label` stay strings.
- Text that can't be a child element, such as an input placeholder:

  ```tsx
  const searchPlaceholder = useCopy("leads.inbox.search.placeholder", "Search leads…");
  <input placeholder={searchPlaceholder} data-copy-id="leads.inbox.search.placeholder" />
  ```

  `data-copy-id` lets the Admin click the input to edit it. `SearchInput` takes it
  as `copyId`.
- `DataTable` and `Tabs` take `copyKey`; their column headers and tab names become
  `<copyKey>.column.<header>` and `<copyKey>.tab.<name>`. Sidebar headings, section
  tabs and breadcrumb labels share `nav.<name>`.

## Key convention

`area.screen.element`, lowercase, dot-separated segments of letters, digits and
hyphens (`shared/copy.ts` validates it):

- **area**: the file, e.g. `lead-inbox`, `venues`, `shared` (`src/components/shared`),
  `app-shell` (the sidebar and header), `nav` (navigation names).
- **screen**: the component, in kebab case, e.g. `venue-list`, `event-detail`.
- **element**: the first words of the default text, e.g. `show-archived`;
  placeholders end in `.placeholder`.

One key per distinct string: the same key always has the same default.
`tests/copy-keys.test.ts` scans every `<T>`, `<Plural>` and `useCopy` and fails on a
key used with two defaults or a key that breaks the convention. A different string
needs a different key (add `-2`). Changing a default's wording keeps the key only
when the meaning stays the same; an Admin's override of it then still applies.

## The lint guard

`live-copy/no-literal-text` (`scripts/eslint-live-copy.mjs`, FLOW-244) fails
`npm run lint` on unwrapped text in `src/features/**` and `src/components/**`
(print documents excluded): JSX text with a letter, a string or template literal
rendered as a child (including `?:` branches and `&&` / `||` / `??`), and a literal
`placeholder`. Punctuation and symbols (`·`, `—`, `/`, `:`, `…`, `×`) and other
attributes (`className`, `aria-*`, `title`, `href`) are allowed. For a genuine
exception, disable it for the line with a reason:

```tsx
{/* eslint-disable-next-line live-copy/no-literal-text -- brand name, never edited */}
```

The lint rule sees only literals in JSX. Labels a screen renders from a constant
map or array (e.g. a status label map) are wrapped at the render site with a
dynamic key; the rule can't check those. Use `LabelT` (FLOW-257), which keys the
label by its map value, so one map shares its keys on every screen:

```tsx
<LabelT id="labels.task-status" value={task.status}>{taskStatusLabels[task.status]}</LabelT>
```

Shared maps use the `labels` area (`labels.pipeline-status`, `labels.role`,
`labels.item-kind`, …); a map local to one file uses that file's area
(`event-activity.field`). A line built by joining parts with ` · ` uses
`joined([...])` so its parts can be elements. A table column keeps its string
`accessorFn` (sorting, filtering, export) and adds a `cell` that renders the
`LabelT`. Strings chosen in plain code (`x ? "Supply" : "Ingredient"`) become one
`<T>` per branch.
