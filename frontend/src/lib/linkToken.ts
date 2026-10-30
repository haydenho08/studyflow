// Links in StudyFlow's emails carry their token after "#" (/reset-password#token=…). A URL
// fragment never leaves the browser: it isn't sent to the server, kept in its logs, or passed
// on to other sites as a Referer.

/** The token from a location hash ("#token=abc"), or null. */
export function readLinkToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

/** Take the token out of the address bar (and so out of history), keeping the page. */
export function forgetLinkToken(): void {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
}
