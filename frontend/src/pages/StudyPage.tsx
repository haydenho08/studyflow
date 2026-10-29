import { BookOpen, Timer, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { useCourses, useCreateSession, useDeleteSession, useStudySessions } from "../api/queries";
import type { Course } from "../api/types";
import { useConfirm } from "../components/ConfirmDialog";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { Swatch } from "../components/Swatch";
import { useDisplayColor } from "../hooks/useDisplayColor";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDue, fromDateTimeInput, localDayStart, toDateTimeInput } from "../lib/dates";
import {
  MIN_SESSION_MS,
  PRESETS,
  elapsedMs,
  findPreset,
  formatClock,
  remainingMs,
} from "../lib/pomodoro";
import { formatDuration, mondayOf } from "../lib/week";
import { useTimer } from "../timer/TimerContext";

function TimerCard({ courses }: { courses: Course[] }) {
  const { timer, now, start, finishEarly, cancel, unsaved, saveError, isSaving, retrySave, dismissUnsaved } =
    useTimer();
  const [courseId, setCourseId] = useState(String(courses[0]?.id ?? ""));
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const display = useDisplayColor();

  const running = timer.phase !== "idle";
  const preset = findPreset(running ? timer.presetId : presetId);
  const course = courses.find((c) => c.id === (running ? timer.courseId : Number(courseId)));

  const remaining = running ? remainingMs(timer, now) : preset.focusMinutes * 60_000;
  const progress = running ? 1 - remaining / timer.durationMs : 0;
  const elapsed = timer.phase === "focus" ? elapsedMs(timer, now) : 0;

  return (
    <div className={`card timer-card phase-${timer.phase}`}>
      <div className="timer-phase">
        {timer.phase === "idle" ? "Ready to focus" : timer.phase === "focus" ? "Focus" : "Break"}
        {course && (
          <span className="timer-course">
            <Swatch color={course.color} />
            {course.code}
          </span>
        )}
      </div>

      <div className="timer-clock" role="timer" aria-label="Time remaining">
        {formatClock(remaining)}
      </div>
      <div
        className="timer-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div style={{ width: `${progress * 100}%`, background: course ? display(course.color) : undefined }} />
      </div>

      {timer.phase === "idle" && (
        <div className="timer-controls">
          <label className="field">
            <span>Course</span>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="segmented">
            <legend>Focus / break (minutes)</legend>
            {PRESETS.map((p) => (
              <label key={p.id}>
                <input
                  type="radio"
                  name="preset"
                  value={p.id}
                  checked={presetId === p.id}
                  onChange={() => setPresetId(p.id)}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="btn btn-primary btn-large"
            disabled={!courseId}
            onClick={() => start(Number(courseId), preset)}
          >
            Start focus
          </button>
        </div>
      )}

      {timer.phase === "focus" && (
        <div className="timer-controls">
          <button
            type="button"
            className="btn btn-primary"
            onClick={finishEarly}
            disabled={elapsed < MIN_SESSION_MS}
            title={elapsed < MIN_SESSION_MS ? "Sessions under a minute aren't saved" : undefined}
          >
            Finish early · save {formatDuration(elapsed / 1000)}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (elapsed < MIN_SESSION_MS || window.confirm("Discard this session without saving it?")) cancel();
            }}
          >
            Discard
          </button>
        </div>
      )}

      {timer.phase === "break" && (
        <div className="timer-controls">
          <p className="muted">Session saved. Stretch, drink some water.</p>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Skip break
          </button>
        </div>
      )}

      {unsaved && saveError ? (
        <div className="timer-unsaved">
          <ErrorMessage error={saveError} />
          <button type="button" className="btn btn-primary" onClick={retrySave} disabled={isSaving}>
            Retry saving
          </button>
          <button type="button" className="btn btn-ghost" onClick={dismissUnsaved}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LogSessionForm({ courses }: { courses: Course[] }) {
  const createSession = useCreateSession();
  const [courseId, setCourseId] = useState(String(courses[0]?.id ?? ""));
  const [start, setStart] = useState(() => toDateTimeInput(new Date(Date.now() - 60 * 60_000).toISOString()));
  const [minutes, setMinutes] = useState("25");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const startedAt = new Date(fromDateTimeInput(start));
    const endedAt = new Date(startedAt.getTime() + Number(minutes) * 60_000);
    try {
      await createSession.mutateAsync({
        course_id: Number(courseId),
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
      });
      setSaved(true);
    } catch {
      // shown below via createSession.error
    }
  }

  return (
    <form className="log-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Course</span>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Started</span>
        <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="field">
        <span>Minutes</span>
        <input
          type="number"
          required
          min={1}
          max={720}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-ghost" disabled={createSession.isPending}>
          Log session
        </button>
        {saved && <span className="muted">Saved.</span>}
      </div>
      <ErrorMessage error={createSession.error} />
    </form>
  );
}

function ThisWeek({ courses }: { courses: Course[] }) {
  const weekStart = mondayOf(new Date());
  const sessions = useStudySessions({ started_from: localDayStart(weekStart) });
  const deleteSession = useDeleteSession();
  const confirm = useConfirm();
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  if (sessions.isPending) return <SkeletonList rows={3} height={56} />;
  if (sessions.isError) return <ErrorMessage error={sessions.error} />;

  const total = sessions.data.reduce((sum, s) => sum + s.duration_seconds, 0);

  return (
    <div className="page-section">
      <div className="page-header">
        <h2>This week</h2>
        <span className="muted">
          {formatDuration(total)} across {sessions.data.length} session{sessions.data.length === 1 ? "" : "s"} ·{" "}
          <Link to="/stats">See stats</Link>
        </span>
      </div>
      {sessions.data.length === 0 ? (
        <EmptyState icon={<Timer size={28} />} title="No study logged this week">
          Start a focus session above, or log one you forgot to time.
        </EmptyState>
      ) : (
        <ul className="list">
          {sessions.data.map((s) => {
            const course = courseById.get(s.course_id);
            return (
              <li key={s.id} className="card row-item is-compact">
                <Swatch color={course?.color} />
                <div className="row-main">
                  <div className="row-title">{course?.code}</div>
                  <time className="muted row-meta" dateTime={s.started_at}>
                    {formatDue(s.started_at)}
                  </time>
                </div>
                <div className="row-actions">
                  <span className="session-duration">{formatDuration(s.duration_seconds)}</span>
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    disabled={deleteSession.isPending}
                    aria-label={`Delete the ${course?.code ?? ""} session from ${formatDue(s.started_at)}`}
                    title="Delete"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Delete this study session?",
                        message: `${formatDuration(s.duration_seconds)} of ${course?.code ?? "study"} on ${formatDue(s.started_at)}.`,
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (ok) deleteSession.mutate(s.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorMessage error={deleteSession.error} />
    </div>
  );
}

export function StudyPage() {
  usePageTitle("Study");
  const courses = useCourses();

  if (courses.isPending) return <SkeletonList rows={2} height={180} />;
  if (courses.isError) return <ErrorMessage error={courses.error} />;

  return (
    <section className="page">
      <div className="page-header">
        <h1>Study</h1>
      </div>
      {courses.data.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="Add a course first"
          action={
            <Link to="/courses" className="btn btn-primary">
              Go to Courses
            </Link>
          }
        >
          Study time is tracked per course.
        </EmptyState>
      ) : (
        <>
          <TimerCard courses={courses.data} />
          <details className="card">
            <summary>Forgot to start the timer? Log a past session</summary>
            <LogSessionForm courses={courses.data} />
          </details>
          <ThisWeek courses={courses.data} />
        </>
      )}
    </section>
  );
}
