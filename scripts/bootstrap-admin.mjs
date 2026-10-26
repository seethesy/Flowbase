// One-time first Admin allowlist entry. Run only against the intended database,
// after migrations. No credentials or staff details are written to files/logs.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

const { DATABASE_URL, FLOWBASE_ADMIN_EMAIL, FLOWBASE_ADMIN_MOBILE } =
  process.env;
if (
  !DATABASE_URL ||
  !/^\S+@\S+\.\S+$/.test(FLOWBASE_ADMIN_EMAIL ?? "") ||
  !FLOWBASE_ADMIN_MOBILE?.trim()
) {
  throw new Error(
    "Set DATABASE_URL, FLOWBASE_ADMIN_EMAIL and FLOWBASE_ADMIN_MOBILE in your shell.",
  );
}
const connection = postgres(DATABASE_URL, { max: 1 });
try {
  await drizzle(connection).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(360037)`);
    const existing = await tx.execute(
      sql`select id from public.users where role = 'admin' and status in ('active', 'pending') limit 1`,
    );
    if (existing.length)
      throw new Error(
        "An Admin already exists. Use the Admin user management screen.",
      );
    await tx.execute(
      sql`insert into public.users (email, role, employment_type, mobile) values (${FLOWBASE_ADMIN_EMAIL.toLowerCase()}, 'admin', 'full_time', ${FLOWBASE_ADMIN_MOBILE.trim()})`,
    );
  });
  console.log("First Admin invited. Sign in with that Google account.");
} finally {
  await connection.end();
}
