import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { useCourses, useWeekStats } from "../api/queries";
import type { Course, WeekStats } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { WeekChart } from "../components/WeekChart";
import { useDisplayColor } from "../hooks/useDisplayColor";
import { usePageTitle } from "../hooks/usePageTitle";
import { addDays, browserTimeZone, formatDuration, formatWeekRange, mondayOf, parseLocalDate } from "../lib/week";

const shortDay = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="card stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail && <div className="muted stat-detail">{detail}</div>}
    </div>
  );
}

/** Horizontal bars, one per course, value at the tip. */
function CourseBreakdown({ stats, courseById }: { stats: WeekStats; courseById: Map<number, Course> }) {
  const color = useDisplayColor();
  const max = Math.max(...stats.courses.map((c) => c.seconds));
  return (
    <ul className="breakdown">
      {stats.courses.map((c) => {
        const course = courseById.get(c.course_id);
        return (
          <li key={c.course_id}>
            <span className="breakdown-name">{course?.code ?? "Deleted course"}</span>
            <span className="breakdown-track">
              <span
                className="breakdown-bar"
                style={{ width: `${(c.seconds / max) * 100}%`, background: color(course?.color ?? "#888888") }}
              />
              <span className="breakdown-value">
                {formatDuration(c.seconds)} <span className="muted">· {c.sessions}×</span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The same numbers as the chart, as a table: readable without colour, hover, or sight. */
function StatsTable({ stats, courses }: { stats: WeekStats; courses: Course[] }) {
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">Course</th>
            {stats.days.map((d) => (
              <th key={d.day} scope="col">
                {shortDay.format(parseLocalDate(d.day))}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.code}</th>
              {stats.days.map((d) => {
                const secs = d.courses.find((s) => s.course_id === c.id)?.seconds ?? 0;
                return <td key={d.day}>{secs ? formatDuration(secs) : "–"}</td>;
              })}
              <td>{formatDuration(stats.courses.find((t) => t.course_id === c.id)?.seconds ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {stats.days.map((d) => (
              <td key={d.day}>{d.total_seconds ? formatDuration(d.total_seconds) : "–"}</td>
            ))}
            <td>{formatDuration(stats.total_seconds)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function StatsPage() {
  usePageTitle("Stats");
  const [searchParams, setSearchParams] = useSearchParams();
  const thisWeek = mondayOf(new Date());
  const requested = searchParams.get("week");
  // The week lives in the URL (?week=2026-10-12); anything that isn't a date falls back to now.
  const week = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? mondayOf(parseLocalDate(requested)) : thisWeek;
  const timeZone = browserTimeZone();

  const stats = useWeekStats(week, timeZone);
  const courses = useCourses();
  const courseById = useMemo(() => new Map(courses.data?.map((c) => [c.id, c])), [courses.data]);

  const goTo = (start: string) =>
    setSearchParams(start === thisWeek ? {} : { week: start }, { replace: true });

  // Stacking/legend order: most-studied course first (bottom of each column).
  const chartCourses = (stats.data?.courses ?? [])
    .map((c) => courseById.get(c.course_id))
    .filter((c): c is Course => c !== undefined);

  const data = stats.data;
  const studiedDays = data?.days.filter((d) => d.total_seconds > 0).length ?? 0;
  const best = data?.days.reduce((a, b) => (b.total_seconds > a.total_seconds ? b : a), data.days[0]!);
  const top = data?.courses[0] ? courseById.get(data.courses[0].course_id) : undefined;

  return (
    <section className="page">
      <div className="page-header">
        <h1>Stats</h1>
        <div className="week-nav" role="group" aria-label="Choose week">
          <button type="button" className="btn btn-ghost" onClick={() => goTo(addDays(week, -7))} aria-label="Previous week">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="week-label">{formatWeekRange(week)}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => goTo(addDays(week, 7))}
            disabled={week >= thisWeek}
            aria-label="Next week"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          {week !== thisWeek && (
            <button type="button" className="btn btn-ghost" onClick={() => goTo(thisWeek)}>
              This week
            </button>
          )}
        </div>
      </div>

      {stats.isPending || courses.isPending ? (
        <SkeletonList rows={2} height={160} />
      ) : stats.isError ? (
        <ErrorMessage error={stats.error} />
      ) : data && data.total_seconds === 0 ? (
        <EmptyState
          icon={<BarChart3 size={28} />}
          title={week === thisWeek ? "No study logged this week yet" : "No study logged this week"}
          action={
            week === thisWeek && (
              <Link to="/study" className="btn btn-primary">
                Start a focus session
              </Link>
            )
          }
        />
      ) : data ? (
        <div className={`page-section${stats.isPlaceholderData ? " is-stale" : ""}`}>
          <div className="stat-tiles">
            <StatTile label="Total" value={formatDuration(data.total_seconds)} detail={`${data.session_count} sessions`} />
            <StatTile
              label="Daily average"
              value={formatDuration(data.total_seconds / 7)}
              detail={`studied on ${studiedDays} of 7 days`}
            />
            {best && (
              <StatTile
                label="Best day"
                value={formatDuration(best.total_seconds)}
                detail={new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(parseLocalDate(best.day))}
              />
            )}
            {top && <StatTile label="Most studied" value={top.code} detail={formatDuration(data.courses[0]!.seconds)} />}
          </div>

          <div className="card">
            <h2>Study time per day</h2>
            <WeekChart days={data.days} courses={chartCourses} />
          </div>

          <div className="card">
            <h2>By course</h2>
            <CourseBreakdown stats={data} courseById={courseById} />
          </div>

          <details className="card">
            <summary>Show as table</summary>
            <StatsTable stats={data} courses={chartCourses} />
          </details>
        </div>
      ) : null}
    </section>
  );
}
