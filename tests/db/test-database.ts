// The DB suite drops and re-creates the public and drizzle schemas (FLOW-182), so
// it may only ever run against a local or CI test database.
const testHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);

export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url)
    throw new Error(
      "DATABASE_URL must point to the disposable CI Postgres service.",
    );
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string.");
  }
  if (!testHosts.has(host))
    throw new Error(
      `Refusing to run the DB tests against "${host}": they drop and re-create the public and drizzle schemas. Point DATABASE_URL at a local or CI test database (localhost, 127.0.0.1, ::1 or the postgres service).`,
    );
  return url;
}
