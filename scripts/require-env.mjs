// Exits non-zero when any named environment variable is missing or empty.
// The deploy pipeline (FLOW-25) uses it so drizzle-kit never falls back to the
// CI database URL in drizzle.config.ts.
const missing = process.argv.slice(2).filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}
