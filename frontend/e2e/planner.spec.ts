import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/** Tomorrow at 14:00 in the *browser's* time zone, as a datetime-local value and as its day. */
async function tomorrowAfternoon(page: Page) {
  return page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { input: `${day}T14:00`, day };
  });
}

test("a course, then a deadline, which shows on the calendar and can be ticked off", async ({ page, account }) => {
  test.slow(); // the longest journey in the suite
  void account; // logged in, with no data yet

  await page.goto("/courses");
  await page.getByLabel("Code").fill("EECS 2311");
  await page.getByLabel("Name").fill("Software Development Project");
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByText("Software Development Project")).toBeVisible();

  await page.goto("/assignments");
  await page.getByRole("button", { name: "New assignment" }).click();
  const due = await tomorrowAfternoon(page);
  // The filter bar has "Due from", "Priority"… too: stay inside the new-assignment form.
  const form = page.locator("form", { has: page.getByRole("button", { name: "Add assignment" }) });
  await form.getByLabel("Title").fill("Sprint 1 demo");
  await form.getByLabel("Type").selectOption({ label: "Exam" });
  await form.getByLabel("Due").fill(due.input);
  await form.getByLabel("Priority").selectOption({ label: "High" });
  await form.getByRole("button", { name: "Add assignment" }).click();
  await expect(page.getByText("Sprint 1 demo")).toBeVisible();

  // ?week= jumps straight to the deadline's week, even when "tomorrow" is next Monday.
  await page.goto(`/calendar?week=${due.day}`);
  const day = page.getByRole("listitem", { name: /1 deadlines, 1 open/ });
  await expect(day).toContainText("Sprint 1 demo");
  await expect(day).toContainText("2:00");
  await expect(day).toContainText("EECS 2311");

  // click, not check(): the box flips once the server has saved it, not instantly.
  await day.getByRole("checkbox", { name: 'Mark "Sprint 1 demo" as done' }).click();
  await expect(page.getByRole("checkbox", { name: 'Mark "Sprint 1 demo" as not done' })).toBeChecked();
  await expect(page.getByRole("listitem", { name: /1 deadlines, 0 open/ })).toBeVisible();

  // Saved, not just ticked on screen.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: 'Mark "Sprint 1 demo" as not done' })).toBeChecked();
});

test("assignment filters live in the URL and survive a reload", async ({ page, api }) => {
  const course = await api.createCourse("MATH 1090", "Logic");
  const soon = new Date(Date.now() + 2 * 86_400_000);
  await api.createAssignment(course.id, "Problem set 6", soon);
  await api.createAssignment(course.id, "Problem set 5", soon);

  await page.goto("/assignments");
  await page.getByLabel("Status of Problem set 5").selectOption({ label: "Done" });
  await page.getByRole("search").getByLabel("Status").selectOption({ label: "Done" });

  await expect(page).toHaveURL(/status=done/);
  await expect(page.getByText("Problem set 5")).toBeVisible();
  await expect(page.getByText("Problem set 6")).toBeHidden();

  await page.reload();
  await expect(page.getByText("Problem set 5")).toBeVisible();
  await expect(page.getByText("Problem set 6")).toBeHidden();
});

test("deleting a course asks first, then takes its assignments with it", async ({ page, api }) => {
  const course = await api.createCourse("PHYS 1800", "Mechanics");
  await api.createAssignment(course.id, "Lab 2", new Date(Date.now() + 86_400_000));

  await page.goto("/courses");
  await page.getByRole("button", { name: "Delete PHYS 1800" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete PHYS 1800?" });
  await expect(dialog).toBeVisible();

  // Cancel first: nothing happens.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Mechanics")).toBeVisible();

  await page.getByRole("button", { name: "Delete PHYS 1800" }).click();
  await dialog.getByRole("button", { name: "Delete course" }).click();
  await expect(page.getByText("Mechanics")).toBeHidden();

  await page.goto("/assignments");
  await expect(page.getByText("Lab 2")).toBeHidden();
});
