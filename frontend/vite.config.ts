import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser only ever talks to the Vite server; Vite forwards /api to FastAPI.
    // Same origin in development means no CORS preflights and no hard-coded API host.
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    // Unit tests only; e2e/ is Playwright's (npm run test:e2e).
    include: ["src/**/*.test.ts"],
    // Pin a timezone with a DST change so date tests behave the same on every machine and in CI.
    env: { TZ: "America/Toronto" },
  },
});
