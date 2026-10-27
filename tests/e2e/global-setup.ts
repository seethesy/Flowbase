import setupDatabase from "../db/global-setup";

// Reuse the destructive-test URL guard, migration and seed path used by DB CI.
export default async function setup() {
  await setupDatabase();
}
