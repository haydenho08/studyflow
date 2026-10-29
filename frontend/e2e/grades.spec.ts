import { expect, test } from "./fixtures";

test("weights and marks give the grade so far and what's needed on the rest", async ({ page, api }) => {
  const course = await api.createCourse("EECS 2021", "Computer Organization");
  const past = new Date(Date.now() - 7 * 86_400_000);
  const later = new Date(Date.now() + 30 * 86_400_000);
  await api.createAssignment(course.id, "Midterm", past, { weight: 40, score: 30, out_of: 40 });
  await api.createAssignment(course.id, "Final exam", later);

  // Give the final its weight through the assignment form.
  await page.goto("/assignments");
  await page.getByRole("button", { name: "Edit Final exam" }).click();
  const edit = page.locator("form", { has: page.getByRole("button", { name: "Save" }) });
  await edit.getByLabel("Weight (% of course)").fill("60");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("60% of grade")).toBeVisible();

  await page.goto("/grades");
  const card = page.getByRole("region", { name: /EECS 2021/ });
  await expect(card.getByText("75% · B+")).toBeVisible(); // 30 of 40
  await expect(card.getByText("30% – 90%")).toBeVisible();
  // An A (80) needs 50 of the remaining 60 points: 83.333…%, shown rounded *up*.
  await expect(card.getByRole("row", { name: /^A 80%\+/ })).toContainText("83.34%");

  // The final is marked: 54 / 60.
  await card.getByLabel("Mark for Final exam").fill("54");
  await card.getByLabel("Final exam is out of").fill("60");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("84% · A")).toBeVisible();
  await expect(card.getByRole("row", { name: /^A 80%\+/ })).toContainText("Secured");
});
