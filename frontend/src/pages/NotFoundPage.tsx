import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { BrandMark } from "../components/Feedback";
import { usePageTitle } from "../hooks/usePageTitle";

export function NotFoundPage() {
  usePageTitle("Page not found");
  return (
    <div className="auth-page">
      <div className="card not-found">
        <BrandMark size={20} />
        <p className="not-found-code">404</p>
        <h1>This page doesn't exist</h1>
        <p className="muted">The link may be mistyped, or the page may have moved.</p>
        <Link to="/" className="btn btn-primary">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to StudyFlow
        </Link>
      </div>
    </div>
  );
}
