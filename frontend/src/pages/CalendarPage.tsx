import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { useAssignments, useCourses, useUpdateAssignment } from "../api/queries";
import type { Assignment, Course } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
import { Swatch } from "../components/Swatch";
import { groupByLocalDay, isOverdue, openCount, weekDays } from "../lib/calendar";
import { formatDue, localDayStart } from "../lib/dates";
import { KIND_LABELS, PRIORITY_LABELS } from "../lib/labels";
import { addDays, formatWeekRange, mondayOf, parseLocalDate, toLocalDateString } from "../lib/week";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const fullDayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

/** Link to this deadline on the Assignments page, filtered to its course and day, for editing. */
function editLink(a: Assignment): string {
  const day = toLocalDateString(new Date(a.due_at));
  return `/assignments?course=${a.course_id}&from=${day}&to=${day}`;
}

function DeadlineCard({
  assignment,
  course,
  now,
  showDate = false,
}: {
  assignment: Assignment;
  course: Course | undefined;
  now: Date;
  showDate?: boolean;
}) {
  const update = useUpdateAssignment();
  const done = assignment.status === "done";
  const overdue = isOverdue(assignment, now);

  return (
    <li
      className={`deadline kind-${assignment.kind}${done ? " is-done" : ""}${overdue ? " is-overdue" : ""}`}
    >
      <input
        type="checkbox"
        checked={done}
        disabled={update.isPending}
        aria-label={`Mark "${assignment.title}" as ${done ? "not done" : "done"}`}
        onChange={(e) =>
          update.mutate({ id: assignment.id, changes: { status: e.target.checked ? "done" : "todo" } })
        }
      />
      <div className="deadline-body">
        <time className="deadline-time" dateTime={assignment.due_at}>
          {showDate ? formatDue(assignment.due_at) : timeFormat.format(new Date(assignment.due_at))}
          {overdue && <span className="overdue-tag"> · overdue</span>}
        </time>
        <Link to={editLink(assignment)} className="deadline-title">
          {assignment.title}
        </Link>
        <div className="deadline-meta">
          <Swatch color={course?.color} />
          <span>{course?.code}</span>
          <span className="kind-tag">{KIND_LABELS[assignment.kind]}</span>
          {assignment.priority === "high" && (
            <span className="badge priority-high">{PRIORITY_LABELS.high}</span>
          )}
        </div>
        <ErrorMessage error={update.error} />
      </div>
    </li>
  );
}

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const today = toLocalDateString(now);
  const thisWeek = mondayOf(now);
  const requested = searchParams.get("week");
  const week = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? mondayOf(parseLocalDate(requested)) : thisWeek;

  const courses = useCourses();
  const courseById = useMemo(() => new Map(courses.data?.map((c) => [c.id, c])), [courses.data]);

  // The visible week: [Monday 00:00 local, next Monday 00:00 local), the API's half-open range.
  const deadlines = useAssignments({ due_from: localDayStart(week), due_to: localDayStart(week, 7) });
  // Overdue = not done and due before today. Uses "start of today" rather than "now" so the
  // cache key only changes once a day, instead of on every render.
  const overdue = useAssignments({ status: ["todo", "in_progress"], due_to: localDayStart(today) });

  const days = weekDays(week);
  const byDay = useMemo(() => groupByLocalDay(deadlines.data ?? []), [deadlines.data]);

  const goTo = (monday: string) => setSearchParams(monday === thisWeek ? {} : { week: monday }, { replace: true });

  const weekTotal = deadlines.data?.length ?? 0;
  const weekDone = deadlines.data?.filter((a) => a.status === "done").length ?? 0;

  return (
    <section className="page">
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="week-nav" role="group" aria-label="Choose week">
          <button type="button" className="btn btn-ghost" onClick={() => goTo(addDays(week, -7))} aria-label="Previous week">
            ←
          </button>
          <span className="week-label">{formatWeekRange(week)}</span>
          <button type="button" className="btn btn-ghost" onClick={() => goTo(addDays(week, 7))} aria-label="Next week">
            →
          </button>
          {week !== thisWeek && (
            <button type="button" className="btn btn-ghost" onClick={() => goTo(thisWeek)}>
              Today
            </button>
          )}
        </div>
      </div>

      {overdue.data && overdue.data.length > 0 && (
        <details className="card overdue-panel" open>
          <summary>
            {overdue.data.length} overdue {overdue.data.length === 1 ? "deadline" : "deadlines"}
          </summary>
          <ul className="deadline-list">
            {overdue.data.map((a) => (
              <DeadlineCard key={a.id} assignment={a} course={courseById.get(a.course_id)} now={now} showDate />
            ))}
          </ul>
        </details>
      )}

      {deadlines.isPending ? (
        <p className="muted">Loading…</p>
      ) : deadlines.isError ? (
        <ErrorMessage error={deadlines.error} />
      ) : (
        <>
          <p className="muted week-summary">
            {weekTotal === 0
              ? "No deadlines this week."
              : `${weekTotal} ${weekTotal === 1 ? "deadline" : "deadlines"} this week · ${weekDone} done`}
          </p>
          <ol className={`week-grid${deadlines.isPlaceholderData ? " is-stale" : ""}`}>
            {days.map((day) => {
              const items = byDay.get(day) ?? [];
              const date = parseLocalDate(day);
              const open = openCount(items);
              const isToday = day === today;
              return (
                <li
                  key={day}
                  className={`day${isToday ? " is-today" : ""}${day < today ? " is-past" : ""}`}
                  aria-label={`${fullDayFormat.format(date)}${isToday ? " (today)" : ""}: ${
                    items.length === 0 ? "no deadlines" : `${items.length} deadlines, ${open} open`
                  }`}
                >
                  <div className="day-header">
                    <span className="day-name">{weekdayFormat.format(date)}</span>
                    <span className="day-number">{dayFormat.format(date)}</span>
                    {open > 0 && <span className="day-count">{open}</span>}
                  </div>
                  {items.length === 0 ? (
                    <p className="day-empty">No deadlines</p>
                  ) : (
                    <ul className="deadline-list">
                      {items.map((a) => (
                        <DeadlineCard key={a.id} assignment={a} course={courseById.get(a.course_id)} now={now} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
