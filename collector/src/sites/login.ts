import { stopIfBlocked } from "../blocked.ts";
import { SiteStopped, type SiteContext } from "../types.ts";

// Uses only a login form that is already on the page after visiting the inbox.
// Never submits any other form or attempts to handle a challenge.
export async function logInWithCredentials({ page, credentials }: SiteContext) {
  if (!credentials) throw new SiteStopped("needs_login", "Collector credentials are missing.");
  const username = page.locator('input[autocomplete="username"], input[type="email"], input[name="username"], input[name="email"]').first();
  const password = page.locator('input[type="password"]').first();
  if (!(await username.isVisible().catch(() => false)))
    throw new SiteStopped("needs_login", "A supported login form was not found.");
  await username.fill(credentials.username);
  if (!(await password.isVisible().catch(() => false))) {
    const next = page.getByRole("button", { name: /^(continue|next)$/i }).first();
    if (!(await next.isVisible().catch(() => false)))
      throw new SiteStopped("needs_login", "A supported login form was not found.");
    await next.click();
    await stopIfBlocked(page, null);
  }
  if (!(await password.isVisible().catch(() => false)))
    throw new SiteStopped("needs_login", "The password form was not found.");
  await password.fill(credentials.password);
  const submit = page.getByRole("button", { name: /^(sign in|log in|login)$/i }).first();
  if (!(await submit.isVisible().catch(() => false)))
    throw new SiteStopped("needs_login", "A supported login submit button was not found.");
  await submit.click();
  await stopIfBlocked(page, null);
}
