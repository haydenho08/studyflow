import { expect, signUpViaApi, test, uniqueEmail } from "./fixtures";

test("a visitor signs up from the front page and lands on their calendar @phone", async ({ page }) => {
  const email = uniqueEmail();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("in one place");
  await page.getByRole("link", { name: "Get started" }).click();

  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("No deadlines this week.")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("logging in takes you back to the page you asked for", async ({ page, request }) => {
  const account = await signUpViaApi(request);

  await page.goto("/stats");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/stats$/);
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
});

test("a wrong password is refused without saying which part was wrong", async ({ page, request }) => {
  const account = await signUpViaApi(request);

  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("not-my-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
  await expect(page).toHaveURL(/\/login$/);
});

test("the demo button opens a ready-made account @phone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).first().click();

  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto("/courses");
  await expect(page.getByText("EECS 2030")).toBeVisible();
});
