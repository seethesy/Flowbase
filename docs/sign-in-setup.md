# Google sign-in and staff access

FLOW-36/37 use Supabase Auth for Google OAuth (PKCE) and `public.users` as the
invite-only allowlist. The browser obtains public Auth configuration from
`GET /api/auth/config`; no additional Vite build variables are needed. The Worker
verifies issuer, audience, expiry, signature and Google OAuth authentication,
then reads the current role, employment type and status from Postgres on every
request. Role claims supplied by the browser are never used for authorization.

Live configuration and completion checks are tracked in [FLOW-210](https://sybertechlabs.atlassian.net/browse/FLOW-210).

Only `GET /api/health`, public Auth configuration, and machine ingestion are
outside staff authentication. Ingestion retains its service-token/webhook
authentication. Demo records and the dev database-check route now require staff
authentication too. Health and configuration contain no staff data.

## Developer setup

Perform these steps separately for each enabled environment. Never add real
credentials to this repo or its GitHub Actions. Keep non-production branch builds
disabled (FLOW-176).

1. Apply the committed Drizzle migrations to the intended database. Production
   Workers Builds does this before deployment; dev migrations remain manual.
   `0017` adds the RLS-protected `users` table; the custom Drizzle migration `0018`
   installs `public.flowbase_before_user_created(jsonb)`. Do not paste schema SQL
   into the Supabase editor or change generated migrations.
2. In Supabase Authentication → Hooks, enable **Before User Created** and select
   `public.flowbase_before_user_created`. The hook rejects creation unless the
   email has a pending, unarchived invitation. It accepts the Google provider and
   Supabase's Admin invitation records (`provider=email`), which do not activate
   the Flowbase account. Every other provider is rejected. This hook must be
   enabled before exposing sign-in; the Worker also independently denies accounts
   absent from the allowlist. See the [Supabase hook documentation](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).
3. Enable **Google only** in Sign In / Providers; disable the Email, Phone,
   Anonymous and other sign-in providers. Leave **Allow new users to sign up** on
   so invited Google accounts can be created; the hook enforces the allowlist.
   Keep email auto-confirm disabled. The Worker requires a Google OAuth session,
   so invitation-confirmation email sessions cannot access the app.
4. Configure Supabase's Site URL and Redirect URLs for the exact app origin (the
   production Worker URL, and localhost for dev). Google consent and provider
   credentials were configured in FLOW-160. No Google client secret is consumed
   by this app. Configure an asymmetric JWT signing key for cached JWKS
   verification; legacy HS256 keys are verified through Supabase's Auth server.
5. In Cloudflare Worker runtime variables/secrets, set:

   | Name | Type | Value source |
   | --- | --- | --- |
   | `SUPABASE_URL` | Text | Project URL for the same database bound by Hyperdrive |
   | `SUPABASE_PUBLISHABLE_KEY` | Text | Supabase publishable key (legacy anon key also works) |
   | `SUPABASE_SECRET_KEY` | Secret | Supabase secret key (legacy service-role key also works); server only, used to send Admin invitations |
   | `APP_URL` | Text | This environment's app origin, with no route/query |

   The production Supabase project is `hzmgxkyitvlzcnecywai`; dev is
   `qlnjdckcrawrcgcoecpl`. Keep the URL, keys and Hyperdrive database from the same
   project. For local development, use ignored `.dev.vars`.
6. Configure invitation email delivery in Supabase Authentication. Its default
   mail service restricts recipients to project team members and is unsuitable
   for staff invitations; use the free SMTP provider selected under ADR-12 and
   verify a sender. Configure the invitation template to explain that staff must
   use **Continue with Google** with the invited email after confirmation. Use
   the supported Supabase confirmation URL in the template. App access is only
   activated after Google OAuth; an emailed invitation token grants no Flowbase
   access. See [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
7. Bootstrap the first Admin once. In your own shell set `DATABASE_URL` to the
   intended database, `FLOWBASE_ADMIN_EMAIL` to your Google email and
   `FLOWBASE_ADMIN_MOBILE` to your mobile. Run `node scripts/bootstrap-admin.mjs`,
   then clear those shell variables. The script uses Drizzle for the data write
   and refuses if a pending/active Admin exists. It creates a pending allowlist
   entry only; sign in with Google to activate it. The script sends no email.

## Manual completion check

1. Sign in with the first invited Google account, including a personal Gmail
   account. Confirm its actual profile name and role appear, then open Settings
   → Manage users. Invite a second account with role, employment type and mobile.
2. Check receipt of the invitation and a resent invitation, sign in with Google,
   and confirm the entry changes from Pending to Active. Confirm identity linking
   also works if the invited user signs in directly before opening the email.
3. Try an uninvited Google account. Confirm the clear refusal and check Supabase
   Authentication → Users to verify no Auth user was created. No application user
   should have been created either. Revoke a pending invite and repeat.
4. Deactivate the second account while it has an open session. Its next API
   request must be refused. Confirm its stored name and audit/time-report history
   remain visible. Reactivate and sign in again; the staff id/history must match.
5. Call `/api/admin/users` as a non-Admin (403) and without a token (401).
6. Sign out and verify workspace content disappears, including after refresh.
   Expire/revoke a refresh session on a filtered record route; confirm sign-in
   retains that route and returns to it after Google OAuth.

Invitations use Supabase's built-in Admin invitation API; this adds no paid
service or separate mail integration. Failed delivery leaves the pending entry
visible and reports an actionable Resend error. Resend is limited by Supabase's
email rate limits. Revocation and deactivation never delete Auth or application
records, and history resolves names without filtering inactive users.
