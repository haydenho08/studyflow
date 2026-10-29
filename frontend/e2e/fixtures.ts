// Shared setup: each test gets its own brand-new account, so tests never see each other's data.
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

export { expect };

export interface Account {
  email: string;
  password: string;
  token: string;
}

let counter = 0;

export function uniqueEmail(): string {
  counter += 1;
  return `e2e-${Date.now()}-${process.pid}-${counter}@example.com`;
}

/** Register through the API (fast), for tests whose subject isn't signing up. */
export async function signUpViaApi(request: APIRequestContext): Promise<Account> {
  const email = uniqueEmail();
  const password = "correct-horse-battery";
  expect((await request.post("/api/auth/register", { data: { email, password } })).status()).toBe(201);
  const login = await request.post("/api/auth/login", { form: { username: email, password } });
  expect(login.ok()).toBe(true);
  return { email, password, token: (await login.json()).access_token };
}

/** A small typed client for setting up data through the API as `account`. */
export function apiAs(request: APIRequestContext, account: Account) {
  const headers = { Authorization: `Bearer ${account.token}` };
  return {
    async createCourse(code: string, name = "Course") {
      const response = await request.post("/api/courses", { headers, data: { code, name } });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: number; code: string };
    },
    async createAssignment(courseId: number, title: string, dueAt: Date) {
      const data = { course_id: courseId, title, due_at: dueAt.toISOString() };
      const response = await request.post("/api/assignments", { headers, data });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: number };
    },
  };
}

/** Start the page logged in as `account`, the way the app stores its session. */
export async function logInPage(page: Page, account: Account) {
  await page.addInitScript((token) => localStorage.setItem("studyflow.token", token), account.token);
}

export const test = base.extend<{ account: Account; api: ReturnType<typeof apiAs> }>({
  account: async ({ request, page }, use) => {
    const account = await signUpViaApi(request);
    await logInPage(page, account);
    await use(account);
  },
  api: async ({ request, account }, use) => {
    await use(apiAs(request, account));
  },
});
