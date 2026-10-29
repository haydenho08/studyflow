import { expect, test } from "./fixtures";

test("a weekly lab: create the series, edit this and following, delete just one", async ({ page, api }) => {
  await api.createCourse("EECS 2021", "Computer Organization");

  await page.goto("/assignments");
  await page.getByRole("button", { name: "New assignment" }).click();
  const form = page.locator("form", { has: page.getByRole("button", { name: "Add assignment" }) });
  await form.getByLabel("Title").fill("Lab {n}");
  await form.getByLabel("Type").selectOption({ label: "Lab" });
  await form.getByLabel("Repeats weekly").check();
  await form.getByLabel("Deadlines", { exact: true }).fill("3");
  await expect(form.getByText(/^Every week on \w{3}, 3 times\./)).toBeVisible();
  await form.getByRole("button", { name: "Add assignment" }).click();

  const titles = page.locator(".row-title");
  await expect(titles).toHaveText(["Lab 1", "Lab 2", "Lab 3"]);
  await expect(page.getByText("Repeats", { exact: true })).toHaveCount(3);

  // Rename Lab 2 and the ones after it, keeping the numbering with {n}.
  await page.getByRole("button", { name: "Edit Lab 2" }).click();
  const edit = page.locator("form", { has: page.getByRole("button", { name: "Save" }) });
  await edit.getByLabel("Title").fill("Lab {n}: graded");
  await edit.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "This and following" }).click();
  await expect(titles).toHaveText(["Lab 1", "Lab 2: graded", "Lab 3: graded"]);

  // Delete only Lab 3: the rest of the series stays.
  await page.getByRole("button", { name: "Delete Lab 3: graded" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Only this one" }).click();
  await expect(titles).toHaveText(["Lab 1", "Lab 2: graded"]);
});
