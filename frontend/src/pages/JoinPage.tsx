import { Link2Off, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError } from "../api/client";
import { useAcceptInvite, useInvitePreview } from "../api/queries";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { Swatch } from "../components/Swatch";
import { usePageTitle } from "../hooks/usePageTitle";

/** /join/<token>: what an invite link is for, and a button to join. Behind login (RequireAuth),
 *  so someone without an account signs up first and comes straight back here. */
export function JoinPage() {
  usePageTitle("Join a course");
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();

  if (preview.isPending) return <SkeletonList rows={1} />;
  if (preview.error instanceof ApiError && preview.error.status === 404) {
    return (
      <section className="page">
        <EmptyState icon={<Link2Off size={28} />} title="This invite link doesn't work">
          It may have been replaced or turned off. Ask whoever sent it for a new one.
        </EmptyState>
      </section>
    );
  }
  if (preview.isError) return <ErrorMessage error={preview.error} />;

  const course = preview.data;
  const coursePage = `/assignments?course=${course.course_id}`;
  const people = course.member_count + 1;

  return (
    <section className="page">
      <div className="card join-card">
        <p className="muted join-eyebrow">
          <Users size={16} aria-hidden="true" />
          {course.owner_email} shared a course with you
        </p>
        <h1 className="join-title">
          <Swatch color={course.color} />
          {course.code}
        </h1>
        <p className="join-name">{course.name}</p>
        <p className="muted">
          {people} {people === 1 ? "person" : "people"} so far. Joining puts its deadlines on your calendar,
          and you can add to them. Your progress, marks and study time stay yours: nobody else sees them.
        </p>

        {course.role === "owner" ? (
          <p>
            This is your own course. <Link to="/courses">Back to your courses</Link>
          </p>
        ) : course.role === "member" ? (
          <p>
            You're already in it. <Link to={coursePage}>See its deadlines</Link>
          </p>
        ) : (
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={accept.isPending}
              onClick={() => accept.mutate(token, { onSuccess: () => navigate(coursePage) })}
            >
              {accept.isPending ? "Joining…" : `Join ${course.code}`}
            </button>
            <Link to="/calendar" className="btn btn-ghost">
              Not now
            </Link>
          </div>
        )}
        <ErrorMessage error={accept.error} />
      </div>
    </section>
  );
}
