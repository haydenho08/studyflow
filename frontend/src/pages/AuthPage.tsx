import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";

import { ApiError } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { useAuth } from "../auth/AuthContext";

const MAX_PASSWORD_BYTES = 72; // bcrypt's limit, enforced by the API too
const SOURCE_URL = "https://github.com/haydenho08/studyflow";

/** What a first-time visitor (often a recruiter) sees: what this is, and a way in without sign-up. */
function Pitch() {
  const { loginDemo } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setError(null);
    setPending(true);
    try {
      await loginDemo(); // on success the token is set and AuthPage redirects
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "The demo isn't switched on for this server."
          : "Couldn't start the demo. The server may still be waking up: try again in a few seconds.",
      );
      setPending(false);
    }
  }

  return (
    <section className="pitch" aria-labelledby="pitch-title">
      <h1 id="pitch-title" className="brand">
        StudyFlow
      </h1>
      <p className="pitch-tagline">Your courses, deadlines and study time, in one place.</p>
      <ul className="pitch-features">
        <li>A week calendar of every deadline, with overdue work flagged</li>
        <li>A Pomodoro timer that logs focused time per course</li>
        <li>Weekly stats: where your study hours actually went</li>
      </ul>
      <button
        type="button"
        className="btn btn-primary btn-large"
        onClick={startDemo}
        disabled={pending}
      >
        {pending ? "Opening the demo…" : "Explore the demo"}
      </button>
      <p className="muted pitch-note">
        No sign-up: a sample student account with this week's data.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="pitch-source">
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          View the source on GitHub
        </a>
      </p>
    </section>
  );
}

/** Login and register are the same form with a different submit action. */
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { isAuthenticated, login, register } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Once the token is set this re-renders and redirects: back to the page that sent us here.
  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    // Client-side checks are for fast feedback only; the API is the real authority.
    if (isRegister && new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      setLocalError(`Password must be at most ${MAX_PASSWORD_BYTES} bytes.`);
      return;
    }
    setSubmitting(true);
    try {
      await (isRegister ? register(email, password) : login(email, password));
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <Pitch />

        <form className="card auth-card" onSubmit={handleSubmit}>
          <h2>{isRegister ? "Create your account" : "Log in"}</h2>

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
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {isRegister && <small className="muted">At least 8 characters.</small>}
          </label>

          {localError && (
            <p className="error" role="alert">
              {localError}
            </p>
          )}
          <ErrorMessage error={error} />

          <button type="submit" className="btn btn-ghost" disabled={submitting}>
            {submitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}
          </button>

          <p className="muted switch-mode">
            {isRegister ? (
              <>
                Already have an account? <Link to="/login">Log in</Link>
              </>
            ) : (
              <>
                New here? <Link to="/register">Create an account</Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
