// Regenerates the README screenshots in docs/screenshots/.
//
// Prerequisites: API + Vite dev server running, and the demo account seeded:
//   cd backend && python -m scripts.seed_demo
//   cd frontend && npm run screenshots
//
// Uses playwright-core with the installed Microsoft Edge (channel "msedge"), so there's no
// separate browser download. Set BROWSER_CHANNEL=chrome to use Google Chrome instead.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = new URL("../../docs/screenshots/", import.meta.url);
const EMAIL = "demo@studyflow.app";
const PASSWORD = process.env.DEMO_PASSWORD ?? "studyflow-demo";
const TZ = "America/Toronto";

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

const { access_token: token } = await api("/api/auth/login", {
  method: "POST",
  body: new URLSearchParams({ username: EMAIL, password: PASSWORD }),
});
const auth = { headers: { Authorization: `Bearer ${token}` } };
const me = await api("/api/auth/me", auth);
const courses = await api("/api/courses", auth);

// A focus block 6m18s in, so the Study page (and the top-bar pill) show a live timer.
const runningTimer = JSON.stringify({
  phase: "focus",
  userId: me.id,
  courseId: courses.find((c) => c.code === "EECS 2030").id,
  presetId: "classic",
  startedAt: Date.now() - (6 * 60 + 18) * 1000,
  durationMs: 25 * 60 * 1000,
});

/** Monday of last week in TZ, as YYYY-MM-DD (date-only arithmetic in UTC, so no DST surprises). */
function lastWeekMonday() {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).split("-");
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  return date.toISOString().slice(0, 10);
}

const shots = [
  { name: "calendar", path: "/calendar", ready: ".week-grid", scheme: "light" },
  { name: "calendar-dark", path: "/calendar", ready: ".week-grid", scheme: "dark" },
  // The last full week makes a better chart than a week that may have just started.
  { name: "stats", path: `/stats?week=${lastWeekMonday()}`, ready: ".chart svg", scheme: "light" },
  { name: "study", path: "/study", ready: ".timer-clock", scheme: "light", timer: true },
  { name: "assignments", path: "/assignments", ready: ".list", scheme: "light" },
  {
    name: "calendar-mobile",
    path: "/calendar",
    ready: ".week-grid",
    scheme: "dark",
    viewport: { width: 390, height: 844 },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge" });

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: shot.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: shot.scheme,
    timezoneId: TZ,
    locale: "en-CA",
  });
  // Log in by planting the token before any page script runs (the same thing login does).
  await context.addInitScript(
    ([t, timer]) => {
      localStorage.setItem("studyflow.token", t);
      if (timer) localStorage.setItem("studyflow.timer", timer);
      else localStorage.removeItem("studyflow.timer");
    },
    [token, shot.timer ? runningTimer : null],
  );

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`);
  await page.waitForSelector(shot.ready);
  await page.waitForTimeout(400); // let transitions settle
  const file = fileURLToPath(new URL(`${shot.name}.png`, OUT));
  await page.screenshot({ path: file });
  console.log(`saved docs/screenshots/${shot.name}.png`);
  await context.close();
}

await browser.close();
