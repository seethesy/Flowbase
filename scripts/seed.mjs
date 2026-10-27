import { createServer } from "vite";

// Use the project's existing TypeScript loader; no extra runtime dependency.
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { seedDatabase } = await server.ssrLoadModule("/worker/db/seed.ts");
  await seedDatabase(process.env.DATABASE_URL, process.env.NODE_ENV);
  console.log("Development seed complete (existing rows preserved).");
} finally {
  await server.close();
}
