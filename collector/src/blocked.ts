import type { Page, Response } from "@playwright/test";
import { SiteStopped } from "./types.ts";

// Design rule (ADR-14, §3.4): on a CAPTCHA, a block or a two-factor prompt the
// collector stops that site and reports it. It never tries to get past one.
const captchaSelectors = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "#challenge-form",
  "[data-captcha]",
];
const blockedText =
  /verify (that )?you are (a )?human|are you a robot|unusual traffic|access denied|temporarily blocked|too many requests/i;
const twoFactorSelectors = ['input[autocomplete="one-time-code"]', "[data-two-factor]"];
const twoFactorText =
  /two-factor|two-step verification|2-step verification|verification code|enter the code we (sent|texted|emailed)/i;

export async function stopIfBlocked(page: Page, response: Response | null) {
  const status = response?.status() ?? 200;
  if (status === 403 || status === 429)
    throw new SiteStopped("blocked", `The site answered ${status}.`);
  for (const selector of captchaSelectors)
    if (await page.locator(selector).count())
      throw new SiteStopped("blocked", "The site showed a CAPTCHA.");
  for (const selector of twoFactorSelectors)
    if (await page.locator(selector).count())
      throw new SiteStopped("needs_login", "The site asked for a two-factor code.");
  const text = await page.locator("body").innerText().catch(() => "");
  if (twoFactorText.test(text))
    throw new SiteStopped("needs_login", "The site asked for a two-factor code.");
  if (blockedText.test(text))
    throw new SiteStopped("blocked", "The site blocked the collector.");
}
