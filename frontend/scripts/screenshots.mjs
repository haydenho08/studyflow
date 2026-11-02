// Regenerates the screenshots: docs/screenshots/*.png for the README, and the landing page's
// frontend/src/assets/landing/*.webp, from the same captures of the demo account.
//
// Prerequisites: API + Vite dev server running, with the demo endpoint switched on
// (DEMO_ENABLED=true), then:
//   cd frontend && npm run screenshots
//
// Pages are captured with reduced motion, so entrance animations are already settled.
//
// Uses playwright-core with the installed Microsoft Edge (channel "msedge"), so there's no
// separate browser download. Set BROWSER_CHANNEL=chrome to use Google Chrome instead.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const DOCS = new URL("../../docs/screenshots/", import.meta.url);
const LANDING = new URL("../src/assets/landing/", import.meta.url);
const TZ = "America/Toronto";
// The address shown in the invite-link screenshot, instead of localhost.
const SHOWN_SITE = "https://studyflow-q3u0.onrender.com";
// Two sample classmates who join a demo course, so the sharing dialog has people in it.
// Local-only accounts, created on the dev database the first time this runs.
const CLASSMATES = ["maya.chen@example.com", "jordan.lee@example.com"];
const CLASSMATE_PASSWORD = "local-screenshots-only";

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// The demo login also rebuilds the demo data if it's over an hour old.
const { access_token: token } = await api("/api/auth/demo", { method: "POST" });
const me = await api("/api/auth/me", { headers: bearer(token) });
const courses = await api("/api/courses", { headers: bearer(token) });
const eecs2030 = courses.find((c) => c.code === "EECS 2030");

// Share EECS 2030 and have the classmates join it.
const { path: invitePath } = await api(`/api/courses/${eecs2030.id}/invite`, { headers: bearer(token) });
const invite =
  invitePath ??
  (await api(`/api/courses/${eecs2030.id}/invite`, { method: "POST", headers: bearer(token) })).path;
for (const email of CLASSMATES) {
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: CLASSMATE_PASSWORD }),
  }); // a 409 on later runs: they already exist
  const login = new URLSearchParams({ username: email, password: CLASSMATE_PASSWORD });
  const { access_token } = await api("/api/auth/login", { method: "POST", body: login });
  await api(`/api/invites/${invite.replace("/join/", "")}`, {
    method: "POST",
    headers: bearer(access_token),
  });
}

// A focus block 6m18s in, so the Study page (and the top-bar pill) show a live timer.
const runningTimer = JSON.stringify({
  phase: "focus",
  userId: me.id,
  courseId: eecs2030.id,
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

const DESKTOP = { width: 1280, height: 800 };
const FEATURE = { width: 1300, height: 812 }; // the landing page's feature shots
const PHONE = { width: 390, height: 844 };

/** Open the course's share dialog, with the invite link showing the public site's address. */
async function openShareDialog(page) {
  await page.getByRole("button", { name: "Share EECS 2030" }).click();
  const link = page.getByLabel("Invite link");
  await link.waitFor();
  await link.evaluate((input, site) => {
    input.value = site + new URL(input.value).pathname;
  }, SHOWN_SITE);
  await page.getByRole("dialog").getByText("jordan.lee@example.com").waitFor(); // members loaded
}

const shots = [
  { name: "calendar", path: "/calendar", ready: ".week-grid", scheme: "light", webp: FEATURE },
  { name: "calendar-dark", path: "/calendar", ready: ".week-grid", scheme: "dark" },
  // The last full week makes a better chart than a week that may have just started.
  {
    name: "stats",
    path: `/stats?week=${lastWeekMonday()}`,
    ready: ".chart svg",
    scheme: "light",
    webp: FEATURE,
  },
  { name: "study", path: "/study", ready: ".timer-clock", scheme: "light", timer: true, webp: FEATURE },
  { name: "assignments", path: "/assignments", ready: ".list", scheme: "light", webp: FEATURE },
  { name: "grades", path: "/grades", ready: ".grade-card", scheme: "light", webp: FEATURE },
  {
    name: "sharing",
    path: "/courses",
    ready: ".list",
    scheme: "light",
    webp: FEATURE,
    then: openShareDialog,
  },
  {
    name: "calendar-mobile",
    path: "/calendar",
    ready: ".week-grid",
    scheme: "dark",
    viewport: PHONE,
    webp: { width: 520, height: 1125 },
  },
  // The landing hero: wider than tall, light and dark (the page picks by the visitor's setting).
  {
    name: "hero-calendar",
    path: "/calendar",
    ready: ".week-grid",
    scheme: "light",
    viewport: { width: 1280, height: 680 },
    webp: { width: 1600, height: 850 },
    docs: false,
  },
  {
    name: "hero-calendar-dark",
    path: "/calendar",
    ready: ".week-grid",
    scheme: "dark",
    viewport: { width: 1280, height: 680 },
    webp: { width: 1600, height: 850 },
    docs: false,
  },
];

await mkdir(DOCS, { recursive: true });
await mkdir(LANDING, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge" });

/** PNG -> WebP at `size`, using the browser's own canvas encoder (no image library needed). */
async function toWebp(png, size) {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(
    async ([src, width, height]) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width, height });
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/webp", 0.82);
    },
    [`data:image/png;base64,${png.toString("base64")}`, size.width, size.height],
  );
  await page.close();
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: shot.viewport ?? DESKTOP,
    deviceScaleFactor: 2,
    colorScheme: shot.scheme,
    timezoneId: TZ,
    locale: "en-CA",
    reducedMotion: "reduce",
  });
  // Log in the way a returning user is: the refresh cookie in the browser (context.request
  // shares the context's cookies), plus the "logged in" hint. The app then restores the login.
  await context.request.post(`${BASE}/api/auth/demo`);
  await context.addInitScript(
    (timer) => {
      localStorage.setItem("studyflow.session", "1");
      if (timer) localStorage.setItem("studyflow.timer", timer);
      else localStorage.removeItem("studyflow.timer");
    },
    shot.timer ? runningTimer : null,
  );

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`);
  await page.waitForSelector(shot.ready);
  if (shot.then) await shot.then(page);
  await page.waitForTimeout(400); // let transitions settle
  const png = await page.screenshot();
  if (shot.docs !== false) {
    await writeFile(fileURLToPath(new URL(`${shot.name}.png`, DOCS)), png);
    console.log(`saved docs/screenshots/${shot.name}.png`);
  }
  if (shot.webp) {
    await writeFile(fileURLToPath(new URL(`${shot.name}.webp`, LANDING)), await toWebp(png, shot.webp));
    console.log(`saved src/assets/landing/${shot.name}.webp`);
  }
  await context.close();
}

await browser.close();
