import { expect, test } from "./fixtures";

test("a full 25-minute focus block is saved and counted in the stats", async ({ page, api }) => {
  await api.createCourse("EECS 2021", "Computer Organization");

  // A fake clock, so 25 minutes pass in an instant. It starts 40 minutes in the past: the API
  // (rightly) refuses sessions that end in the future, and this one ends ~15 minutes ago.
  await page.clock.install({ time: new Date(Date.now() - 40 * 60_000) });

  await page.goto("/study");
  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByRole("timer")).toHaveText("25:00");
  // The countdown shows in the top bar too, on every page.
  await expect(page.getByRole("link", { name: "Go to the running timer" })).toBeVisible();

  await page.clock.fastForward("25:01");

  await expect(page.getByText("Session saved.")).toBeVisible();
  await expect(page.getByText("25m across 1 session")).toBeVisible();

  await page.getByRole("link", { name: "See stats" }).click();
  await expect(page.getByText("1 sessions")).toBeVisible();
  await expect(page.locator(".stat-tile").first()).toContainText("25m");
});

test("finishing early saves only the time actually spent", async ({ page, api }) => {
  await api.createCourse("MATH 1090", "Logic");
  await page.clock.install({ time: new Date(Date.now() - 40 * 60_000) });

  await page.goto("/study");
  await page.getByRole("button", { name: "Start focus" }).click();
  await page.clock.fastForward("10:00");
  await page.getByRole("button", { name: /Finish early · save 10m/ }).click();

  await expect(page.getByText("10m across 1 session")).toBeVisible();
});
