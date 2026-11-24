import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Offline BEO access (FLOW-150, ADR-18): the service worker keeps the app
    // itself available with no signal; the BEO data is saved in IndexedDB by
    // src/offline. API calls are never cached or answered by the worker.
    // New deployments (FLOW-325): "prompt" keeps a new version waiting until
    // src/app/appUpdate.ts applies it (fresh load, next navigation or the
    // Reload notice), so unsaved edits are never lost to an automatic reload.
    // The app registers the worker itself (virtual:pwa-register in main.tsx).
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        globPatterns: ["**/*.{js,css,html,woff,woff2,svg,png,ico}"],
        // The layout annotation editor (Excalidraw) and its diagram, locale and font
        // chunks are online-only (annotating needs the network), so they are not
        // precached; everything else the app needs is.
        globIgnores: [
          "**/*Diagram-*.js",
          "**/[a-z][a-z]-[A-Z][A-Z]-*.js",
          "**/{cytoscape,cose-bilkent,katex,cynefin,percentages,subset-shared,swimlanes,image-blob-reduce,pica,timeline-definition,mermaid}*.js",
        ],
        maximumFileSizeToCacheInBytes: 3_000_000,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return "react-runtime";
          if (id.includes("prosemirror") || id.includes("@tiptap/pm")) return "editor-engine";
          if (id.includes("@tiptap")) return "editor";
          if (id.includes("recharts") || /node_modules\/d3-|node_modules\/(victory-vendor|internmap|decimal.js-light|react-smooth)\//.test(id)) return "charts";
          if (id.includes("@sentry")) return "observability";
          if (id.includes("@supabase")) return "auth";
          // Table and query libraries, so the app chunk stays under the 500 kB budget.
          if (id.includes("@tanstack")) return "tanstack";
          // Validation schemas (shared with the Worker), for the same reason (FLOW-284).
          if (/node_modules\/zod\//.test(id)) return "zod";
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
