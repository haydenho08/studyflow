// Links that hand the feed's URL to a calendar app.

/** webcal:// opens the system calendar app (Apple Calendar, Outlook) with "subscribe" filled in. */
export function webcalUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:\/\//, "webcal://");
}

/** Google Calendar's "add by URL" page, with the feed already filled in. */
export function googleCalendarUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}
