import { Check, Copy, Rss } from "lucide-react";
import { useRef, useState } from "react";

import { absoluteApiUrl } from "../api/client";
import { useCalendarFeed, useCreateCalendarFeed, useDeleteCalendarFeed } from "../api/queries";
import { googleCalendarUrl, webcalUrl } from "../lib/calendarFeed";
import { useConfirm } from "./ConfirmDialog";
import { ErrorMessage } from "./ErrorMessage";

/** "Subscribe" button + dialog: put your deadlines in Google, Apple or Outlook calendar. */
export function CalendarFeedButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  // Only fetched once the dialog is opened: most visits to the calendar never need it.
  const feed = useCalendarFeed(open);
  const create = useCreateCalendarFeed();
  const remove = useDeleteCalendarFeed();
  const busy = create.isPending || remove.isPending;
  const url = feed.data?.path ? absoluteApiUrl(feed.data.path) : null;

  function show() {
    setOpen(true);
    setCopied(false);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard access (e.g. not served over HTTPS): select the link for a manual copy.
      inputRef.current?.select();
    }
  }

  async function replace() {
    const ok = await confirm({
      title: "Make a new link?",
      message: "Calendars subscribed with the current link will stop updating until you add the new one.",
      confirmLabel: "Make new link",
      danger: true,
    });
    if (ok) create.mutate(undefined, { onSuccess: () => setCopied(false) });
  }

  async function turnOff() {
    const ok = await confirm({
      title: "Turn off the calendar feed?",
      message: "The link stops working, and calendars subscribed to it stop getting your deadlines.",
      confirmLabel: "Turn off",
      danger: true,
    });
    if (ok) remove.mutate();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={show}>
        <Rss size={16} aria-hidden="true" />
        Subscribe
      </button>
      <dialog
        ref={dialogRef}
        className="dialog dialog-wide"
        aria-labelledby="feed-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="dialog-panel">
          <h2 id="feed-title">Your deadlines in your calendar</h2>
          <p className="muted">
            Subscribe from Google, Apple or Outlook calendar and every deadline shows up there, kept up to date
            as you add, move or finish them.
          </p>

          {feed.isPending ? (
            <div className="skeleton feed-skeleton" aria-busy="true" aria-label="Loading" />
          ) : feed.isError ? (
            <ErrorMessage error={feed.error} />
          ) : url ? (
            <div className="feed">
              <div className="feed-url">
                <input
                  ref={inputRef}
                  readOnly
                  value={url}
                  aria-label="Calendar feed link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="btn btn-ghost" onClick={copy}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="feed-apps">
                <a className="btn btn-primary btn-sm" href={googleCalendarUrl(url)} target="_blank" rel="noreferrer">
                  Add to Google Calendar
                </a>
                <a className="btn btn-ghost btn-sm" href={webcalUrl(url)}>
                  Add to Apple or Outlook
                </a>
              </div>
              <p className="muted feed-note">
                Keep this link private: anyone who has it can see your deadlines. Calendar apps check for changes
                every few hours.
              </p>
              <div className="feed-manage">
                <button type="button" className="btn btn-ghost btn-sm" onClick={replace} disabled={busy}>
                  Make a new link
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={turnOff} disabled={busy}>
                  Turn off
                </button>
              </div>
            </div>
          ) : (
            <div className="feed">
              <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={busy}>
                <Rss size={16} aria-hidden="true" />
                {create.isPending ? "Turning on…" : "Get my calendar link"}
              </button>
            </div>
          )}
          <ErrorMessage error={create.error ?? remove.error} />

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
