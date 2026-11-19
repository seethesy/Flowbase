# Live text editing

The admin can change the app's built-in wording (headings, labels, button text, help text, empty states, input placeholders) on screen, without a code change (FLOW-240 to FLOW-244).

## How it works

- Every built-in string is written as `<T id="area.screen.element">Default text</T>`, or `useCopy("area.screen.element", "Default text")` where it can't be an element (an input's `placeholder`). Both live in `src/app/live-copy.tsx`.
- The admin's saved wording is stored per key in `ui_copy` (`worker/routes/copy.ts`): `GET /api/copy` for everyone signed in; `PUT /api/copy` (a batch) and `DELETE /api/copy/<key>` (reset to the default) need `copy.edit`, which only Admin has. A key with no row shows the default from the code.
- Overrides are plain text and render as text only, never as HTML.
- The pencil in the header (Admin only) turns on edit mode: every wrapped string gets a dashed outline, and clicking one opens an editor. Clicking text inside a button or link edits it instead of using the button or link; clicking an input edits its placeholder. Strings that differ from their default show a dot, with **Reset to default** in the editor. **Save** writes every pending edit for everyone at once; **Cancel** discards them and leaves edit mode. Leaving a page with unsaved edits asks Save / Discard / Stay.

## Writing wrapped text

- **Keys:** `area.screen.element`, lowercase words joined by hyphens, segments joined by dots, e.g. `leads.inbox.empty`, `clients.detail.contacts-heading`. Screens wrapped by the FLOW-241/242/243 codemod use `<file>.<component>.<words-of-the-text>`, e.g. `lead-inbox.lead-inbox.new-lead`.
- **One key per distinct string.** The same key must always carry the same default; `tests/live-copy.test.tsx` fails when two places use one key with different text. Reusing a key on purpose (the same label in two places) means one edit changes both.
- **Live values** use `{placeholders}` with `values`: `<T id="leads.inbox.count" values={{ count }}>{"{count} leads"}</T>`. An edit must keep exactly the default's placeholders; the editor and the API both refuse one that drops, misspells or invents one. Values may be elements (`values={{ name: <strong>{name}</strong> }}`).
- **Plurals** use two keys, `<id>.one` and `<id>.other`: `<TPlural id="leads.inbox.count" count={n} one="{count} lead" other="{count} leads" />` (or `useCopyPlural`). Don't build plurals by concatenating strings.
- **Text with a branch** wraps each branch: `{saving ? <T id="…saving">Saving…</T> : <T id="…save">Save</T>}`.
- **Shared components** take wrapped text in their display props (`<Section title={<T …>…</T>}>`, `FormField` `label` and `hint`, `PageHeader`, `EmptyState`, `DetailDrawer`, `ConfirmationDialog`, `KpiCard`). `DataTable` wraps plain string column headers itself (`tables.<label>.<column>`), and `Tabs` its tab names (`tabs.<name>`).

## What isn't wrapped

Record data, print and PDF documents (`/print/*`, `src/components/print`, `print-sample`), the sign-in screen, the DEMO badge, toasts, form validation messages, server-generated notification text, `aria-label`s, `title` tooltips and native `<option>` labels.

## Lint guard

`scripts/eslint-live-copy.mjs` (`live-copy/wrap-text`, FLOW-244) fails `npm run lint` on unwrapped JSX text, string literals rendered as children (including `?:`, `&&`, `||` and `??` branches) and literal `placeholder`s in `src/features`, `src/components` and `src/app`. Punctuation- and symbol-only text passes. Print files, `src/app/auth.tsx` and `src/app/live-copy.tsx` are exempt in `eslint.config.js`. For a genuine exception add `// eslint-disable-next-line live-copy/wrap-text -- <reason>` (in JSX, `{/* … */}`), sparingly.
