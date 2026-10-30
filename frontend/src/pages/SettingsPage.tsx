import { KeyRound, Mail, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { accountApi } from "../api/endpoints";
import { useServerConfig } from "../api/queries";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage } from "../components/ErrorMessage";
import { usePageTitle } from "../hooks/usePageTitle";

const DEMO_EMAIL = "demo@studyflow.app";

/** Submit state for one settings form: pending, error, and a success message. */
function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(action: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      setDone(await action());
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return { pending, error, done, run };
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="card settings-section" aria-labelledby={id}>
      <h2 id={id}>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Done({ message }: { message: string | null }) {
  return message ? (
    <p className="success-line" role="status">
      {message}
    </p>
  ) : null;
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const action = useAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void action.run(async () => {
      await accountApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      return "Password changed. Your other devices have been logged out.";
    });
  }

  return (
    <Section icon={<KeyRound size={18} aria-hidden="true" />} title="Password">
      <form className="settings-form" onSubmit={submit}>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <small className="muted">At least 8 characters. Other devices will be logged out.</small>
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Saving…" : "Change password"}
          </button>
        </div>
        <ErrorMessage error={action.error} />
        <Done message={action.done} />
      </form>
    </Section>
  );
}

function EmailSection({ email }: { email: string }) {
  const config = useServerConfig();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void action.run(async () => {
      const { detail } = await accountApi.changeEmail(password, newEmail);
      setPassword("");
      return `${detail}. Your email changes once you click it.`;
    });
  }

  return (
    <Section icon={<Mail size={18} aria-hidden="true" />} title="Email">
      <p>
        You log in as <strong>{email}</strong>.
      </p>
      {config.data && !config.data.email_enabled ? (
        <p className="muted">Changing it needs email, which isn't set up on this server.</p>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          <label className="field">
            <span>New email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={action.pending}>
              {action.pending ? "Sending…" : "Send confirmation link"}
            </button>
          </div>
          <ErrorMessage error={action.error} />
          <Done message={action.done} />
        </form>
      )}
    </Section>
  );
}

function DeleteSection({ email }: { email: string }) {
  const { logout } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const action = useAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void action.run(async () => {
      await accountApi.deleteAccount(password);
      await logout(); // the session is already gone on the server; this tidies up this tab
      return null;
    });
  }

  return (
    <Section icon={<Trash2 size={18} aria-hidden="true" />} title="Delete account">
      <p className="muted">
        Deletes your account and everything in it: courses, deadlines, marks and study time. Courses you
        shared are deleted for the people you shared them with, too. This can't be undone.
      </p>
      <div className="form-actions">
        <button type="button" className="btn btn-danger" onClick={() => dialogRef.current?.showModal()}>
          Delete my account…
        </button>
      </div>
      <dialog ref={dialogRef} className="dialog" aria-labelledby="delete-account-title">
        <form className="dialog-panel settings-form" onSubmit={submit}>
          <h2 id="delete-account-title">Delete your account?</h2>
          <p className="muted">
            To confirm, type your email (<strong>{email}</strong>) and your password.
          </p>
          <label className="field">
            <span>Your email</span>
            <input autoComplete="off" required value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorMessage error={action.error} />
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-ghost"
              autoFocus
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              // Typing the address makes it a deliberate act, not a slip of the finger.
              disabled={action.pending || typed.trim().toLowerCase() !== email}
            >
              {action.pending ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </form>
      </dialog>
    </Section>
  );
}

export function SettingsPage() {
  usePageTitle("Settings");
  const { user } = useAuth();
  if (!user) return null; // RequireAuth waits for the user, so this is only a type guard

  return (
    <section className="page settings-page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      {user.email === DEMO_EMAIL ? (
        <p className="notice" role="note">
          This is the shared demo account, so its password and email can't be changed and it can't be deleted.
          Create your own account to try these.
        </p>
      ) : (
        <>
          <EmailSection email={user.email} />
          <PasswordSection />
          <DeleteSection email={user.email} />
        </>
      )}
    </section>
  );
}
