// The pages behind "Forgot password?" and the links in StudyFlow's emails. Public: they work
// logged out, on whichever device the email was opened.
import { useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { accountApi } from "../api/endpoints";
import { queryKeys, useServerConfig } from "../api/queries";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage } from "../components/ErrorMessage";
import { BrandMark } from "../components/Feedback";
import { usePageTitle } from "../hooks/usePageTitle";
import { forgetLinkToken, readLinkToken } from "../lib/linkToken";

function LinkPage({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title);
  return (
    <div className="auth-page">
      <div className="card auth-card link-card">
        <Link to="/" className="brand">
          <BrandMark size={20} />
          StudyFlow
        </Link>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** The token from the address bar: read once, then removed from the URL (and so from history). */
function useLinkToken(): string | null {
  const [token] = useState(() => readLinkToken(window.location.hash));
  useEffect(forgetLinkToken, []);
  return token;
}

function NewPasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>New password</span>
      <input
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <small className="muted">At least 8 characters.</small>
    </label>
  );
}

export function ForgotPasswordPage() {
  const config = useServerConfig();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      setSent((await accountApi.requestPasswordReset(email)).detail);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (config.data && !config.data.email_enabled) {
    return (
      <LinkPage title="Reset your password">
        <p className="muted">This server can't send email, so passwords can't be reset here.</p>
        <Link to="/login">Back to log in</Link>
      </LinkPage>
    );
  }

  return (
    <LinkPage title="Reset your password">
      {sent ? (
        <>
          <p className="success-line" role="status">
            <MailCheck size={18} aria-hidden="true" />
            {sent}.
          </p>
          <p className="muted">
            The link works once, for an hour. Check your spam folder if it doesn't arrive.
          </p>
        </>
      ) : (
        <form className="link-form" onSubmit={submit}>
          <p className="muted">
            Enter your account's email and we'll send you a link to choose a new password.
          </p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <ErrorMessage error={error} />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="muted switch-mode">
        <Link to="/login">Back to log in</Link>
      </p>
    </LinkPage>
  );
}

export function ResetPasswordPage() {
  const token = useLinkToken();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setPending(true);
    try {
      await accountApi.resetPassword(token, password);
      navigate("/login", { replace: true, state: { notice: "Password changed. Log in with the new one." } });
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }

  if (!token) {
    return (
      <LinkPage title="Choose a new password">
        <p className="muted">
          This page needs the link from your email. Open it from there, or ask for a new one.
        </p>
        <Link to="/forgot-password">Send a new link</Link>
      </LinkPage>
    );
  }

  return (
    <LinkPage title="Choose a new password">
      <form className="link-form" onSubmit={submit}>
        <p className="muted">This logs you out on every device, in case someone else knew the old one.</p>
        <NewPasswordField value={password} onChange={setPassword} />
        <ErrorMessage error={error} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </button>
      </form>
      {error !== null && (
        <p className="muted switch-mode">
          <Link to="/forgot-password">Send a new link</Link>
        </p>
      )}
    </LinkPage>
  );
}

export function ConfirmEmailPage() {
  const token = useLinkToken();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  // A button, not an automatic confirm on load: some email scanners open links to check them,
  // and that mustn't be what changes someone's address.
  async function confirm() {
    if (!token) return;
    setError(null);
    setPending(true);
    try {
      setConfirmed((await accountApi.confirmEmail(token)).email);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me }); // the account menu's email
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <LinkPage title="Confirm your new email">
      {!token ? (
        <p className="muted">This page needs the link from your email. Open it from there.</p>
      ) : confirmed ? (
        <>
          <p className="success-line" role="status">
            <MailCheck size={18} aria-hidden="true" />
            Your account now uses {confirmed}.
          </p>
          <Link to={isAuthenticated ? "/settings" : "/login"} className="btn btn-primary">
            {isAuthenticated ? "Back to settings" : "Log in"}
          </Link>
        </>
      ) : (
        <>
          <p className="muted">Use this address for your StudyFlow account from now on?</p>
          <ErrorMessage error={error} />
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={pending}>
            {pending ? "Confirming…" : "Confirm new email"}
          </button>
        </>
      )}
    </LinkPage>
  );
}
