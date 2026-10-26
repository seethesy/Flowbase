import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    // Drops and re-creates the schemas, then migrates once (FLOW-182).
    globalSetup: ["./tests/db/global-setup.ts"],
  },
});
