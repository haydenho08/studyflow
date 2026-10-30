import { expect, test, uniqueEmail } from "./fixtures";

test("share a course: a classmate signs up from the link, joins, and keeps their own progress", async ({
  page,
  api,
  browser,
}) => {
  const course = await api.createCourse("EECS 2311", "Software Development Project");
  await api.createAssignment(course.id, "Sprint 1 demo", new Date(Date.now() + 3 * 86_400_000));

  // Alice (the owner) gets an invite link.
  await page.goto("/courses");
  await page.getByRole("button", { name: "Share EECS 2311" }).click();
  const share = page.getByRole("dialog", { name: "Share EECS 2311" });
  await share.getByRole("button", { name: "Get an invite link" }).click();
  const link = await share.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  // Bob has no account yet: the link sends him to log in, he signs up instead, and lands back on it.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto(link);
  await expect(bob).toHaveURL(/\/login$/);
  await bob.getByRole("link", { name: "Create an account" }).click();
  await bob.getByLabel("Email").fill(uniqueEmail());
  await bob.getByLabel("Password").fill("correct-horse-battery");
  await bob.getByRole("button", { name: "Create account" }).click();

  await expect(bob.getByText("shared a course with you")).toBeVisible();
  await bob.getByRole("button", { name: "Join EECS 2311" }).click();
  await expect(bob).toHaveURL(/\/assignments\?course=\d+$/);
  await bob.getByLabel("Status of Sprint 1 demo").selectOption({ label: "Done" });
  await expect(bob.getByLabel("Status of Sprint 1 demo")).toHaveValue("done");

  // Bob's "done" is his own: for Alice, it's still to do.
  await page.goto("/assignments");
  await expect(page.getByLabel("Status of Sprint 1 demo")).toHaveValue("todo");

  // Alice sees Bob in the course; Bob sees who shared it, and leaves.
  await page.goto("/courses");
  await expect(page.getByText("Shared with 1")).toBeVisible();
  await bob.goto("/courses");
  await expect(bob.getByText(/^Shared by e2e-/)).toBeVisible();
  await bob.getByRole("button", { name: "People in EECS 2311" }).click();
  await bob.getByRole("dialog", { name: "EECS 2311" }).getByRole("button", { name: "Leave" }).click();
  await bob
    .getByRole("dialog", { name: "Leave EECS 2311?" })
    .getByRole("button", { name: "Leave course" })
    .click();
  await expect(bob.getByText("No courses yet")).toBeVisible();
  await bobContext.close();
});

test("a replaced invite link stops working", async ({ page, api }) => {
  await api.createCourse("MATH 1090", "Logic");
  await page.goto("/courses");
  await page.getByRole("button", { name: "Share MATH 1090" }).click();
  const share = page.getByRole("dialog", { name: "Share MATH 1090" });
  await share.getByRole("button", { name: "Get an invite link" }).click();
  const old = await share.getByLabel("Invite link").inputValue();

  await share.getByRole("button", { name: "Make a new link" }).click();
  await page
    .getByRole("dialog", { name: "Make a new invite link?" })
    .getByRole("button", { name: "Make new link" })
    .click();
  await expect(share.getByLabel("Invite link")).not.toHaveValue(old);

  await page.goto(old);
  await expect(page.getByText("This invite link doesn't work")).toBeVisible();
});
