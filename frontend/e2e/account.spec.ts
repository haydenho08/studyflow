import { expect, signUpViaApi, test, uniqueEmail } from "./fixtures";
import { linkEmailedTo } from "./outbox";

const NEW_PASSWORD = "a-brand-new-passphrase";

async function logIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("forgot password: the emailed link sets a new one", async ({ page, request }) => {
  const account = await signUpViaApi(request);

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has an account");

  const link = await linkEmailedTo(account.email);
  expect(link).toContain("/reset-password#token=");
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password$/); // the token is taken out of the address bar
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status")).toHaveText("Password changed. Log in with the new one.");
  await logIn(page, account.email, account.password);
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
  await logIn(page, account.email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/calendar$/);

  // The link worked once; it doesn't work again.
  await page.goto(link);
  await page.getByLabel("New password").fill("yet-another-passphrase");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("alert")).toHaveText("This link has expired or was already used");
});

test("change the password in settings", async ({ page, account }) => {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const password = page.getByRole("region", { name: "Password" });
  await password.getByLabel("Current password").fill(account.password);
  await password.getByLabel("New password").fill(NEW_PASSWORD);
  await password.getByRole("button", { name: "Change password" }).click();
  await expect(password.getByRole("status")).toContainText("Password changed");
});

test("change the email: it switches once the link sent to the new address is clicked", async ({
  page,
  account,
}) => {
  const newEmail = uniqueEmail();
  await page.goto("/settings");
  const email = page.getByRole("region", { name: "Email" });
  await email.getByLabel("New email").fill(newEmail);
  await email.getByLabel("Password").fill(account.password);
  await email.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(email.getByRole("status")).toContainText(`We sent a confirmation link to ${newEmail}`);
  await expect(email.getByText(`You log in as ${account.email}`)).toBeVisible(); // not yet changed

  await page.goto(await linkEmailedTo(newEmail));
  await page.getByRole("button", { name: "Confirm new email" }).click();
  await expect(page.getByRole("status")).toHaveText(`Your account now uses ${newEmail}.`);
  await page.getByRole("link", { name: "Back to settings" }).click();
  await expect(page.getByText(`You log in as ${newEmail}`)).toBeVisible();
});

test("delete the account @phone", async ({ page, account }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  const confirm = dialog.getByRole("button", { name: "Delete forever" });
  await dialog.getByLabel("Password").fill(account.password);
  await expect(confirm).toBeDisabled(); // until the email is typed too
  await dialog.getByLabel("Your email").fill(account.email);
  await confirm.click();

  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, account.email, account.password);
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
});
