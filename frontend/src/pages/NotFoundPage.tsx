import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="centered">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to StudyFlow</Link>
      </p>
    </div>
  );
}
