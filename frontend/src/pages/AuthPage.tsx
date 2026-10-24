import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";

import { ErrorMessage } from "../components/ErrorMessage";
import { useAuth } from "../auth/AuthContext";

const MAX_PASSWORD_BYTES = 72; // bcrypt's limit, enforced by the API too

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
    const from = (location.state as { from?: string } | null)?.from ?? "/assignments";
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
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1 className="brand">StudyFlow</h1>
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

        <button type="submit" className="btn btn-primary" disabled={submitting}>
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
  );
}
