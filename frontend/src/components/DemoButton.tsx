import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** One click into the sample account. On success the token is set and the page redirects itself. */
export function DemoButton({
  label = "Explore the demo",
  className = "btn btn-primary btn-large",
}: {
  label?: string;
  className?: string;
}) {
  const { loginDemo } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setError(null);
    setPending(true);
    try {
      await loginDemo();
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
    <>
      <button type="button" className={className} onClick={startDemo} disabled={pending}>
        {pending ? "Opening the demo…" : label}
        {!pending && <ArrowRight size={18} aria-hidden="true" />}
      </button>
      {error && (
        <p className="error demo-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
