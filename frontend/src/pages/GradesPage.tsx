import { BookOpen, GraduationCap } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { useAssignments, useCourses, useGrades, useUpdateAssignment } from "../api/queries";
import type { Assignment, Course, CourseGrades } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { Swatch } from "../components/Swatch";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDue } from "../lib/dates";
import { decimalOrNull, describeTarget, formatPercent } from "../lib/grades";

const ALL = {}; // no filters: every assignment, so every weighted one is here

/** Score / out of, edited in place. Saving sends only the mark. */
function MarkEditor({ assignment }: { assignment: Assignment }) {
  const update = useUpdateAssignment();
  const saved = { score: assignment.score?.toString() ?? "", outOf: assignment.out_of?.toString() ?? "" };
  const [score, setScore] = useState(saved.score);
  const [outOf, setOutOf] = useState(saved.outOf);
  const changed = score !== saved.score || outOf !== saved.outOf;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate({ id: assignment.id, changes: { score: decimalOrNull(score), out_of: decimalOrNull(outOf) } });
  }

  return (
    <form className="mark-editor" onSubmit={save}>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        aria-label={`Mark for ${assignment.title}`}
        placeholder="—"
        value={score}
        onChange={(e) => setScore(e.target.value)}
      />
      <span className="muted" aria-hidden="true">
        /
      </span>
      <input
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        aria-label={`${assignment.title} is out of`}
        required={score.trim() !== ""}
        value={outOf}
        onChange={(e) => setOutOf(e.target.value)}
      />
      {changed && (
        <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending}>
          Save
        </button>
      )}
      <ErrorMessage error={update.error} />
    </form>
  );
}

function CourseGradeCard({
  course,
  grades,
  items,
}: {
  course: Course;
  grades: CourseGrades | undefined;
  items: Assignment[];
}) {
  const remaining = grades ? grades.total_weight - grades.graded_weight : 0;

  return (
    <section className="card grade-card" aria-labelledby={`grades-${course.id}`}>
      <h2 id={`grades-${course.id}`} className="grade-card-title">
        <Swatch color={course.color} />
        {course.code}
        <span className="muted grade-card-name">{course.name}</span>
      </h2>

      {!grades || grades.total_weight === 0 ? (
        <p className="muted">
          Nothing weighted yet. Give this course's deadlines a weight (Edit on the{" "}
          <Link to={`/assignments?course=${course.id}`}>Assignments</Link> page) to track your grade.
        </p>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-label">So far</div>
              <div className="stat-value">
                {grades.current === null ? "—" : `${formatPercent(grades.current)} · ${grades.current_letter}`}
              </div>
              <div className="muted stat-detail">{formatPercent(grades.graded_weight)} of the course marked</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Final grade will be</div>
              <div className="stat-value">
                {formatPercent(grades.lowest ?? 0)} – {formatPercent(grades.highest ?? 0)}
              </div>
              <div className="muted stat-detail">zero vs. full marks on the rest</div>
            </div>
          </div>
          {grades.total_weight !== 100 && (
            <p className="notice" role="note">
              The weights add up to {formatPercent(grades.total_weight)}, not 100%. Until the rest are entered,
              these numbers treat what's there as the whole course.
            </p>
          )}

          <div className="table-scroll">
            <table className="stats-table grade-targets">
              <caption className="sr-only">What you need for each letter grade</caption>
              <thead>
                <tr>
                  <th scope="col">Grade</th>
                  <th scope="col">Final %</th>
                  <th scope="col">You need on the remaining {formatPercent(remaining)}</th>
                </tr>
              </thead>
              <tbody>
                {grades.targets.map((target) => (
                  <tr key={target.letter} className={`target-${target.status}`}>
                    <th scope="row">{target.letter}</th>
                    <td>{formatPercent(target.minimum)}+</td>
                    <td>{describeTarget(target)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-scroll">
            <table className="stats-table grade-items">
              <caption className="sr-only">Marks for {course.code}</caption>
              <thead>
                <tr>
                  <th scope="col">Deadline</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Mark</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.title}
                      <div className="muted grade-item-due">{formatDue(item.due_at)}</div>
                    </th>
                    <td>{formatPercent(item.weight ?? 0)}</td>
                    <td>
                      {/* key: start over from the saved mark whenever it changes on the server */}
                      <MarkEditor key={`${item.score}/${item.out_of}`} assignment={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function GradesPage() {
  usePageTitle("Grades");
  const courses = useCourses();
  const grades = useGrades();
  const assignments = useAssignments(ALL);

  const gradesByCourse = useMemo(() => new Map(grades.data?.map((g) => [g.course_id, g])), [grades.data]);
  const weightedByCourse = useMemo(() => {
    const byCourse = new Map<number, Assignment[]>();
    for (const a of assignments.data ?? []) {
      if (a.weight === null) continue;
      byCourse.set(a.course_id, [...(byCourse.get(a.course_id) ?? []), a]);
    }
    return byCourse;
  }, [assignments.data]);

  const error = courses.error ?? grades.error ?? assignments.error;
  const loading = courses.isPending || grades.isPending || assignments.isPending;
  const courseList = courses.data ?? [];

  return (
    <section className="page">
      <div className="page-header">
        <h1>Grades</h1>
      </div>
      <p className="muted page-intro">
        Weighted deadlines and their marks give each course's grade so far, and what you need on the rest. Letter
        grades use York's scale.
      </p>

      {error ? (
        <ErrorMessage error={error} />
      ) : loading ? (
        <SkeletonList rows={3} />
      ) : courseList.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="Add a course first"
          action={
            <Link to="/courses" className="btn btn-primary">
              Go to Courses
            </Link>
          }
        >
          Grades are worked out per course.
        </EmptyState>
      ) : weightedByCourse.size === 0 ? (
        <EmptyState icon={<GraduationCap size={28} />} title="No weighted deadlines yet">
          Edit a deadline on the <Link to="/assignments">Assignments</Link> page and give it a weight (say, the
          midterm is 30% of the course). Then enter its mark here once you have it.
        </EmptyState>
      ) : (
        courseList.map((course) => (
          <CourseGradeCard
            key={course.id}
            course={course}
            grades={gradesByCourse.get(course.id)}
            items={weightedByCourse.get(course.id) ?? []}
          />
        ))
      )}
    </section>
  );
}
