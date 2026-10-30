import { Check, Copy, Link2, UserMinus, Users } from "lucide-react";
import { useRef, useState } from "react";

import {
  useCourseInvite,
  useCourseMembers,
  useCreateInvite,
  useDeleteInvite,
  useRemoveMember,
} from "../api/queries";
import type { Course } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import { ErrorMessage } from "./ErrorMessage";

/** The invite link (owner only): get it, copy it, replace it or turn it off. */
function InviteLink({ course }: { course: Course }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();
  const invite = useCourseInvite(course.id, true);
  const create = useCreateInvite(course.id);
  const remove = useDeleteInvite(course.id);
  const busy = create.isPending || remove.isPending;
  // A page of this app (not an API path), so it's relative to the site itself.
  const url = invite.data?.path ? new URL(invite.data.path, window.location.origin).href : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      inputRef.current?.select(); // no clipboard access: select it for a manual copy
    }
  }

  async function replace() {
    const ok = await confirm({
      title: "Make a new invite link?",
      message: "The current link stops working. People who already joined stay in.",
      confirmLabel: "Make new link",
      danger: true,
    });
    if (ok) create.mutate(undefined, { onSuccess: () => setCopied(false) });
  }

  async function turnOff() {
    const ok = await confirm({
      title: "Turn off the invite link?",
      message: "Nobody new can join with it. People who already joined stay in.",
      confirmLabel: "Turn off",
      danger: true,
    });
    if (ok) remove.mutate();
  }

  if (invite.isPending)
    return <div className="skeleton feed-skeleton" aria-busy="true" aria-label="Loading" />;
  if (invite.isError) return <ErrorMessage error={invite.error} />;

  return (
    <div className="feed">
      {url ? (
        <>
          <div className="feed-url">
            <input
              ref={inputRef}
              readOnly
              value={url}
              aria-label="Invite link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-ghost" onClick={copy}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted feed-note">
            Anyone with a StudyFlow account and this link can join. Send it only to your study group.
          </p>
          <div className="feed-manage">
            <button type="button" className="btn btn-ghost btn-sm" onClick={replace} disabled={busy}>
              Make a new link
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={turnOff} disabled={busy}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={busy}>
          <Link2 size={16} aria-hidden="true" />
          {create.isPending ? "Making a link…" : "Get an invite link"}
        </button>
      )}
      <ErrorMessage error={create.error ?? remove.error} />
    </div>
  );
}

function MemberList({ course, onLeft }: { course: Course; onLeft: () => void }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const members = useCourseMembers(course.id, true);
  const removeMember = useRemoveMember(course.id);
  const isOwner = course.role === "owner";

  async function remove(userId: number, email: string) {
    const leaving = userId === user?.id;
    const ok = await confirm({
      title: leaving ? `Leave ${course.code}?` : `Remove ${email}?`,
      message: leaving
        ? "Its deadlines disappear from your calendar, and your statuses, marks and study time for it are deleted. You'd need a new invite to join again."
        : "They lose access to its deadlines, and their statuses, marks and study time for it are deleted.",
      confirmLabel: leaving ? "Leave course" : "Remove",
      danger: true,
    });
    if (ok) removeMember.mutate(userId, { onSuccess: leaving ? onLeft : undefined });
  }

  if (members.isPending)
    return <div className="skeleton feed-skeleton" aria-busy="true" aria-label="Loading" />;
  if (members.isError) return <ErrorMessage error={members.error} />;

  return (
    <>
      <ul className="member-list" aria-label={`People in ${course.code}`}>
        {members.data.map((member) => (
          <li key={member.user_id}>
            <span className="member-email">
              {member.email}
              {member.user_id === user?.id && <span className="muted"> (you)</span>}
            </span>
            {member.role === "owner" ? (
              <span className="badge">Owner</span>
            ) : (
              (isOwner || member.user_id === user?.id) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void remove(member.user_id, member.email)}
                  disabled={removeMember.isPending}
                >
                  <UserMinus size={14} aria-hidden="true" />
                  {member.user_id === user?.id ? "Leave" : "Remove"}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      <ErrorMessage error={removeMember.error} />
    </>
  );
}

/** "Share" (owner) or "People" (member) button for a course, and its dialog. */
export function ShareCourseButton({ course }: { course: Course }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const isOwner = course.role === "owner";
  const label = isOwner ? `Share ${course.code}` : `People in ${course.code}`;

  function show() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={show}
        aria-label={label}
        title={isOwner ? "Share" : "People"}
      >
        <Users size={16} />
      </button>
      <dialog
        ref={dialogRef}
        className="dialog dialog-wide"
        aria-labelledby={`share-${course.id}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {/* Mounted only while open: the link and the member list are fetched on demand. */}
        {open && (
          <div className="dialog-panel">
            <h2 id={`share-${course.id}`}>{isOwner ? `Share ${course.code}` : course.code}</h2>
            <p className="muted">
              {isOwner
                ? "Classmates who join see its deadlines and can add to them. Everyone ticks off, marks and times their own work: nobody else sees your progress."
                : `Shared by ${course.owner_email}. You see its deadlines and can add to them; your progress, marks and study time are yours alone.`}
            </p>
            {isOwner && <InviteLink course={course} />}
            <h3 className="dialog-subheading">People</h3>
            <MemberList course={course} onLeft={close} />
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={close}>
                Done
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
