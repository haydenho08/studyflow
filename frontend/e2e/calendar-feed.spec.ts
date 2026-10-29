import { expect, test } from "./fixtures";

test("the calendar feed: get a link, subscribe, replace it, turn it off", async ({ page, api, request }) => {
  const course = await api.createCourse("EECS 3311", "Software Design");
  await api.createAssignment(course.id, "Design doc", new Date(Date.now() + 3 * 86_400_000));

  await page.goto("/calendar");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const dialog = page.getByRole("dialog", { name: "Your deadlines in your calendar" });
  await dialog.getByRole("button", { name: "Get my calendar link" }).click();

  const link = dialog.getByLabel("Calendar feed link");
  const first = await link.inputValue();
  expect(first).toMatch(/\/api\/calendar\/[\w-]{43}\.ics$/);
  await expect(dialog.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute(
    "href",
    /^https:\/\/calendar\.google\.com\/.*cid=webcal/,
  );

  // What a calendar app sees: no login, just the secret URL.
  const feed = await request.get(first);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  expect(await feed.text()).toContain("SUMMARY:EECS 3311: Design doc");

  // A new link: the old one stops working at once.
  await dialog.getByRole("button", { name: "Make a new link" }).click();
  await page.getByRole("dialog", { name: "Make a new link?" }).getByRole("button", { name: "Make new link" }).click();
  await expect(link).not.toHaveValue(first);
  const second = await link.inputValue();
  expect((await request.get(first)).status()).toBe(404);
  expect((await request.get(second)).status()).toBe(200);

  // Turned off: back to the start, and the link is dead.
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("dialog", { name: "Turn off the calendar feed?" }).getByRole("button", { name: "Turn off" }).click();
  await expect(dialog.getByRole("button", { name: "Get my calendar link" })).toBeVisible();
  expect((await request.get(second)).status()).toBe(404);
});
