/**
 * The JWT lives here: in memory for fast reads, mirrored to localStorage so a page refresh
 * keeps you logged in. Components subscribe (via useSyncExternalStore) to re-render on change.
 */

const STORAGE_KEY = "studyflow.token";
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked (privacy settings); just start logged out
  }
}

let current = readStored();

function notify() {
  for (const listener of listeners) listener();
}

export function getToken(): string | null {
  return current;
}

export function setToken(token: string | null): void {
  current = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Still works for this tab, just not across refreshes.
  }
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Logging in or out in one tab updates every other open tab.
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    current = event.newValue;
    notify();
  }
});
