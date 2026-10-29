import { abandonRestore, getAccessToken, getSession, setSession } from "../auth/session";

// Empty in development (the Vite proxy forwards /api). Set at build time for a separate API host.
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

/** The full URL of an API path, for handing to something outside the app (a calendar app). */
export function absoluteApiUrl(path: string): string {
  return new URL(BASE_URL + path, window.location.origin).href;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ValidationIssue = { loc: (string | number)[]; msg: string };

/** Turn FastAPI's error body into one readable sentence. */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const { detail } = body;
    if (typeof detail === "string") return detail;
    // 422s carry a list of issues: [{loc: ["body", "title"], msg: "..."}]
    if (Array.isArray(detail)) {
      return (detail as ValidationIssue[]).map((d) => `${d.loc.at(-1)}: ${d.msg}`).join("; ");
    }
  }
  return `Request failed (${status})`;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Couldn't reach the server. Is the API running?";
}

// An array becomes a repeated parameter: { status: ["todo", "done"] } -> ?status=todo&status=done
type QueryValue = string | number | null | undefined | readonly (string | number)[];

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  form?: Record<string, string>;
  query?: Record<string, QueryValue>;
}

let refreshing: Promise<string | null> | null = null;

/**
 * Trade the refresh cookie for a new access token: on page load, and whenever the current one
 * has expired. Resolves to the new token, or null (and logs out) if the login is over.
 *
 * Every refresh *rotates* the cookie, and the server treats a second use of an old one as theft
 * and ends the session. So refreshes must never overlap: one at a time within this tab (a shared
 * promise), and across tabs too (a Web Lock), so a second tab waits and then sends the new cookie.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= withLock(async () => {
    try {
      const response = await fetch(new URL(BASE_URL + "/api/auth/refresh", window.location.origin), {
        method: "POST",
      });
      if (response.ok) {
        const { access_token } = (await response.json()) as {
          access_token: string;
        };
        setSession(access_token);
        return access_token;
      }
      setSession(null); // no cookie, or the login was ended (logged out, expired, revoked)
      return null;
    } catch {
      // Offline or the server is down: that doesn't mean the login is over.
      if (getSession().status === "restoring") abandonRestore();
      return null;
    }
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function withLock<T>(task: () => Promise<T>): Promise<T> {
  // Web Locks are shared by every tab of this site. Very old browsers: just run it.
  return navigator.locks ? await navigator.locks.request("studyflow.refresh", task) : task();
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(BASE_URL + path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
    }
  }

  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = new URLSearchParams(options.form); // sent as application/x-www-form-urlencoded
  }

  const send = (token: string | null) =>
    fetch(url, {
      method: options.method ?? "GET",
      headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
      body,
    });

  const token = getAccessToken();
  let response = await send(token);
  // The access token has expired (or was revoked): get a new one and try once more. Safe even
  // for a POST: a 401 means the server refused before doing anything.
  if (response.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) response = await send(fresh);
  }
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, messageFrom(data, response.status));
  return data as T;
}
