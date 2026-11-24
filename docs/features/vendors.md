## Vendors

The vendor and distributor directory (FLOW-84, `worker/records/vendors.ts`, `shared/vendors.ts`, screens in `src/features/vendors.tsx` at `/vendors` and `/vendors/<id>`). Each vendor has a type (`food_distributor`, `beverage_distributor`, `rental_vendor`, `event_partner`), the vendor portal URL, the business's account number, contacts, order cutoff, delivery days, minimum order, lead time, ordering instructions and notes. The vendor page lists the items they supply: consumables whose preferred vendor they are and rentals sub-rented from them.

| Resource | Routes |
| --- | --- |
| Vendors | `GET /api/vendors?type=&search=&archived=`, `GET/PUT /api/vendors/<id>`, `POST /api/vendors`, `POST /api/vendors/<id>/archive` and `/restore`, `GET /api/vendors/<id>/history` |

- **No passwords:** there is no password field or column, and the API answers 400 to any body with a field named like a password (`pass`, `password`, `passcode`, `pwd`, `secret`), at any depth.
- **Who can do what:** everyone with `inventory.read` reads the directory; `inventory.write` (Admin, Technical, Sales Manager, Kitchen Lead) edits it. Contacts and the account number are FT+ only: they come back `null` for part-time users, who can't change them (an update that omits them keeps them), and history hides them the same way.
- **One vendor per name:** a live name is unique (any case). `ensureVendor(tx, actor, { name, type })` returns the live vendor with that name or creates it; the bar import (FLOW-91) uses it for Imperio.
- **Sub-rentals (FLOW-75):** a rental linked to a vendor (`rental.vendorId`) is a vendor item: it carries the vendor cost (`vendorCostCents`, hidden like other rental costs), the client price (`priceCents`) and the vendor's lead time (`leadTimeDays`). `shared/sub-rentals.ts` holds the rules reservations (FLOW-76) and conflict detection (FLOW-77) apply: a vendor item is available on request, so reserving it never reduces owned availability (`ownedAvailability`; stock in the Vendor section isn't owned), and `leadTimeWarning` flags an event closer than the lead time. Adding vendor items to the vendor's rental request is FLOW-136.

