import { describeError } from "../api/client";

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {describeError(error)}
    </p>
  );
}
