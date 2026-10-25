import { getToken, setToken } from "../auth/token";

// Empty in development (the Vite proxy forwards /api). Set at build time for a separate API host.
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

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

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = new URLSearchParams(options.form); // sent as application/x-www-form-urlencoded
  }

  const url = new URL(BASE_URL + path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
    }
  }

  const response = await fetch(url, { method: options.method ?? "GET", headers, body });
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Our token was rejected (expired or invalid): drop it, which sends the app to /login.
    if (response.status === 401 && token) setToken(null);
    throw new ApiError(response.status, messageFrom(data, response.status));
  }
  return data as T;
}
