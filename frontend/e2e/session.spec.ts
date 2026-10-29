// Staying logged in safely: the access token only in memory, the refresh token in an httpOnly
// cookie, silent renewal, and logging out (here, in other tabs, and on every device).
import type { Page } from "@playwright/test";

import { expect, signUpViaApi, test } from "./fixtures";

async function logOut(page: Page, which: "Log out" | "Log out everywhere") {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: which, exact: true }).click();
}

test("a reload keeps you logged in, with no token anywhere a script could read it", async ({
  page,
  account,
}) => {
  void account;
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  const readable = await page.evaluate(() => ({
    storage: Object.values(localStorage).join(" "),
    cookies: document.cookie,
  }));
  expect(readable.storage).not.toMatch(/eyJ/); // no JWT (they all start with "eyJ")
  expect(readable.cookies).not.toContain("studyflow_refresh"); // httpOnly: invisible to scripts
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "studyflow_refresh")).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/auth",
  });
});

test("an expired access token is swapped for a new one without the user noticing", async ({ page, api }) => {
  await api.createCourse("EECS 3311", "Software Design");
  // The first courses request is refused as if the access token had just expired.
  let refused = false;
  await page.route("**/api/courses", async (route) => {
    if (refused) return route.continue();
    refused = true;
    await route.fulfill({ status: 401, json: { detail: "Could not validate credentials" } });
  });
  const refreshed = page.waitForResponse("**/api/auth/refresh");

  await page.goto("/courses");

  await expect(page.getByText("Software Design")).toBeVisible();
  expect(refused).toBe(true);
  expect((await refreshed).status()).toBe(200);
  await expect(page).toHaveURL(/\/courses$/);
});

test("logging out ends the login: a reload doesn't bring it back @phone", async ({ page, account }) => {
  void account;
  await page.goto("/calendar");
  await logOut(page, "Log out");
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login$/);
});

test("logging out in one tab logs out the others", async ({ page, account }) => {
  void account;
  await page.goto("/calendar");
  const other = await page.context().newPage();
  await other.goto("/stats");
  await expect(other.getByRole("heading", { name: "Stats" })).toBeVisible();

  await logOut(page, "Log out");

  await expect(other).toHaveURL(/\/login$/);
});

test("log out everywhere ends the login on another device too", async ({ page, account, browser }) => {
  // A second device: its own browser profile, logged in to the same account.
  const laptop = await browser.newContext();
  const login = await laptop.request.post("/api/auth/login", {
    form: { username: account.email, password: account.password },
  });
  expect(login.ok()).toBe(true);
  const laptopPage = await laptop.newPage();
  await laptopPage.addInitScript(() => localStorage.setItem("studyflow.session", "1"));
  await laptopPage.goto("/courses");
  await expect(laptopPage.getByRole("heading", { name: "Courses" })).toBeVisible();

  await page.goto("/calendar");
  await logOut(page, "Log out everywhere");
  await page.getByRole("dialog").getByRole("button", { name: "Log out everywhere" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The laptop's next request is refused, and its refresh cookie no longer works either.
  await laptopPage.goto("/stats");
  await expect(laptopPage).toHaveURL(/\/login$/);
  await laptop.close();
});

test("the API refuses a cross-site attempt to use the refresh cookie", async ({ request }) => {
  await signUpViaApi(request); // request now holds a refresh cookie
  const response = await request.post("/api/auth/refresh", {
    headers: { Origin: "https://evil.example" },
  });
  expect(response.status()).toBe(403);
});
