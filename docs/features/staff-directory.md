## Staff directory

`/staff` (FLOW-40, `src/features/staff.tsx`, API `worker/routes/staff.ts` with logic in `worker/records/staff.ts`) lists every invited user except revoked invitations: name, email, mobile number, role, employment type, active flag (`status` is active), notes, qualified positions (labels from the `staff_position` list in business settings) and SMS consent (`users.sms_consent_at`, the opt-in date; STOP replies are the SMS channel's job, FLOW-52). The directory filters by position, employment type and inactive staff, and exports to CSV.

| Route | Purpose |
| --- | --- |
| `GET /api/staff` | The directory, for every signed-in role (`staff.read`) |
| `GET /api/staff/<id>` | One profile |
| `PATCH /api/staff/<id>` | `{name, mobile, role, employmentType, positions, notes, address, drives, hasCar, smsConsent}`, any subset. Anyone may change their own `mobile` and `smsConsent` (`staff.update_self`); everything else, and other people's profiles, needs `users.manage` (Admin). Positions must be active list values, except ones the profile already has. You can't change your own role. Audited as `user` |

**Profile details (FLOW-333)**, on every staff profile, with or without an account: Address (multi-line), Staff ID, Drives and Has a car (Yes, No or not set; `null` is not set), plus Notes as its own section on the profile. Admin edits address, drives and has a car on the profile and inline in the directory, and notes in the Notes section. The Staff ID isn't stored or typed: it is the last 4 digits of the phone number, lengthened one digit at a time while another listed staff member's number ends the same way (`staffIds` in `shared/staff.ts`, worked out on every read), so adding someone whose number ends the same way lengthens both IDs. The directory filters by Drives and Has a car, and the four fields are table columns and CSV columns (address and ID are left out of the file for roles that can't read them). Address and Staff ID follow the mobile number's rule below; drives and has a car show to everyone who can see the directory.

A mobile number shows to FT+ and to the person themselves (`staff_contact` in `shared/visibility.ts`); notes show to FT+ only. Email stays the sign-in identity and isn't editable here: revoke and re-invite to change it. A name Admin sets before the first sign-in is kept; otherwise the Google name is used. The profile page shows the signed-in user's own profile.
