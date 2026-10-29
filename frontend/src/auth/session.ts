/**
 * Who's logged in, as far as this tab knows.
 *
 * The access token (a JWT, valid 15 minutes) lives **only in memory**: never in localStorage,
 * where any script running on the page could read it. What survives a page refresh is the
 * refresh token, in an httpOnly cookie the browser holds and no script can read at all; on load
 * the app trades it for a new access token (api/client.ts refreshAccessToken).
 *
 * localStorage keeps just a hint that a login exists ("1"). It isn't a credential: it saves a
 * pointless refresh request for visitors who were never logged in, and it tells other tabs when
 * you log in or out. Components subscribe via useSyncExternalStore.
 */

export type SessionStatus =
  /** Have a hint of a login: trading the cookie for an access token. */
  "restoring" | "in" | "out";

export interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
}

const HINT_KEY = "studyflow.session";
const listeners = new Set<() => void>();

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== null;
  } catch {
    return false; // storage can be blocked (privacy settings); just start logged out
  }
}

function writeHint(present: boolean): void {
  try {
    if (present) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // This tab still works; other tabs just won't hear about it.
  }
}

// One immutable object per change, so useSyncExternalStore can compare snapshots by identity.
let state: SessionState = {
  status: readHint() ? "restoring" : "out",
  accessToken: null,
};

function update(next: SessionState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getSession(): SessionState {
  return state;
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

/** Logged in with this access token, or (null) logged out. */
export function setSession(accessToken: string | null): void {
  writeHint(accessToken !== null);
  update(accessToken ? { status: "in", accessToken } : { status: "out", accessToken: null });
}

/** Couldn't reach the server to restore the login: show it as logged out, but keep the hint so
 *  the next page load tries again (the cookie may well still be good). */
export function abandonRestore(): void {
  update({ status: "out", accessToken: null });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Logging in or out in one tab updates every other open tab.
window.addEventListener("storage", (event) => {
  if (event.key !== HINT_KEY) return;
  if (event.newValue === null) update({ status: "out", accessToken: null });
  // Logged in elsewhere: the cookie is shared, so this tab can get its own access token.
  else if (state.status === "out") update({ status: "restoring", accessToken: null });
});
