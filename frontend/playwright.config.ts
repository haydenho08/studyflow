// End-to-end tests: a real browser against the real app, the way it runs in production (FastAPI
// serving the built frontend and the API from one origin, on a real PostgreSQL).
//
//   npm run test:e2e                         build, start the API on :8100, run every test
//   E2E_BASE_URL=http://localhost:5173 npx playwright test    against servers you already run
//
// The API reads DATABASE_URL like it always does; every test signs up its own fresh account, so
// tests never share data and can run in parallel against any database.
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = 8100;
const external = process.env.E2E_BASE_URL;
const isCI = Boolean(process.env.CI);
// CI installs Playwright's own Chromium; locally, drive the Edge that Windows already has.
const channel = process.env.E2E_CHANNEL ?? (isCI ? undefined : "msedge");
const python = process.env.PYTHON ?? (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : "python");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI, // a stray test.only must not silently skip the rest in CI
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    // A zone with daylight saving, as the unit and API tests use.
    timezoneId: "America/Toronto",
    locale: "en-CA",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    // The phone layout (bottom tab bar) for the tests tagged @phone.
    { name: "phone", use: { ...devices["Pixel 7"], channel }, grep: /@phone/ },
  ],
  webServer: external
    ? undefined
    : {
        command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
        cwd: fileURLToPath(new URL("../backend", import.meta.url)),
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: !isCI,
        env: {
          STATIC_DIR: fileURLToPath(new URL("dist", import.meta.url)),
          DEMO_ENABLED: "true",
        },
      },
});
