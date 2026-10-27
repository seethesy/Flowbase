// Public test material, used only by the separate local test Worker and Playwright.
// The deployed entry point never imports this module or accepts these tokens.
export const testSigningKey = new TextEncoder().encode(
  "flowbase-local-browser-tests-public-key-26183",
);
export const testIssuer = "https://test.supabase.co/auth/v1";
