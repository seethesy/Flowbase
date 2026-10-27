import { jwtVerify } from "jose";
import { createApp } from "../../worker/app";
import { createActorResolver } from "../../worker/auth";
import { withDb } from "../../worker/db/client";
import { checkDatabase } from "../../worker/health";
import { testIssuer, testSigningKey } from "./test-auth";
import { rentalImporter } from "../fixtures/rental-importer";

// Only this local, un-deployed entry point trusts the public fixture key. Keep the
// normal allowlist lookup and every route/policy/serializer/database operation.
const resolveActor = createActorResolver(withDb, async (token) => {
  try {
    return (
      await jwtVerify(token, testSigningKey, {
        issuer: testIssuer,
        audience: "authenticated",
        algorithms: ["HS256"],
      })
    ).payload;
  } catch {
    return null;
  }
});
// No module importer is registered yet (FLOW-78 onwards); the browser tests run
// the import framework (FLOW-47) through a test importer.
export default createApp({
  withDb,
  checkDatabase,
  resolveActor,
  importModules: [rentalImporter],
});
