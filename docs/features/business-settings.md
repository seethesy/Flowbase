## Business settings

`/settings` (FLOW-45, `src/features/settings.tsx`, API `worker/routes/settings.ts` with logic in `worker/records/settings.ts`, schemas in `shared/settings.ts`). Everyone reads the settings (`settings.read`); only Admin changes them (`settings.manage`). Every change writes an audit row (`setting` or `list_value`); the screen shows the last 100.

- **Company profile:** name, website, sales contact block and logo for printed documents (`PrintLayout`). The browser scales the logo to fit 600 × 240 and re-encodes it as PNG or JPEG; it is stored inline in the profile (at most 200,000 characters), and the audit records only that it changed.
- **Lists** (`list_values`): staff positions, event types, service types, food service styles, dress code presets, lead sources, vehicles, recipe categories, allergens, dietary tags, and rental, decor, kitchen equipment, ingredient and supply categories. Migration `0021` seeds them from `defaultListValues` (the 10 BEO positions, Corporate/Wedding, Full Service, Stationed/Buffet/Plated, the lead sources, Truck 1–3, the ingredient categories); migration `0040` seeds the recipe categories, the FDA major 9 allergens and the four dietary tags. Admin adds, renames, reorders, archives and restores values; labels are unique per list among active values. Records store the label: archived values stay on old records and show as "(archived)", but forms offer only active values. The event form picks event type, service type and food service style from their lists and suggests dress code presets; the inventory item form suggests its kind's categories; the lead inbox filters by lead source; staff profiles pick positions. Inventory sections keep their own screen (FLOW-70); bar categories stay built in because bar count rounding depends on them.
- **Defaults** (`settings` rows `company` and `defaults`): default task managers (all active Admins, copied to each task at creation, or a saved list of specific active people), rental buffer days before and after (1 and 1), per-guest ratio defaults by category (a new item in that category starts with the ratio), default payment terms, urgent (SMS) notification types, the monthly SMS cap (0 sends none), the time-tracking idle cutoff (5 minutes, the FLOW-119 answer), the BEO key fields that trigger re-approval, the run-of-show guest threshold (150) and the BEO cleanup checklist template. No tax rates. A missing or no-longer-valid row reads as the built-in defaults.

| Route | Purpose |
| --- | --- |
| `GET /api/settings` | `{company, defaults, lists}`; lists include archived values, flagged |
| `PUT /api/settings/company`, `PUT /api/settings/defaults` | Replace a settings group |
| `POST /api/settings/lists/<key>` | `{label}` adds a value |
| `PUT /api/settings/lists/<key>/order` | `{ids}` sets the display order |
| `PATCH /api/settings/values/<id>` | `{label}` renames; saved records keep the old label |
| `POST /api/settings/values/<id>/archive`, `/restore` | Archive or restore a value |
| `GET /api/settings/history` | Recent changes (Admin) |

The browser loads settings once per page (`useBusinessSettings`, `src/services/settings.ts`) and refreshes them after Admin's changes; until they load, or if they can't, it uses the same built-in defaults.
