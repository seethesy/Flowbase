import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "editor";
          if (id.includes("recharts") || /node_modules\/d3-|node_modules\/(victory-vendor|internmap|decimal.js-light|react-smooth)\//.test(id)) return "charts";
          if (id.includes("@sentry")) return "observability";
          if (id.includes("@supabase")) return "auth";
        },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts?(x)"],
    exclude: ["tests/worker/**", "tests/db/**"],
  },
});
