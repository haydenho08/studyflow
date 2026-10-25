import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { useCourses, useCreateSession, useDeleteSession, useStudySessions } from "../api/queries";
import type { Course } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
import { Swatch } from "../components/Swatch";
import { useDisplayColor } from "../hooks/useDisplayColor";
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
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  if (sessions.isPending) return <p className="muted">Loading…</p>;
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
        <p className="empty">No study logged this week yet. Start a focus session above.</p>
      ) : (
        <ul className="list">
          {sessions.data.map((s) => {
            const course = courseById.get(s.course_id);
            return (
              <li key={s.id} className="card session-item">
                <Swatch color={course?.color} />
                <span className="course-code">{course?.code}</span>
                <time className="grow muted" dateTime={s.started_at}>
                  {formatDue(s.started_at)}
                </time>
                <span className="session-duration">{formatDuration(s.duration_seconds)}</span>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={deleteSession.isPending}
                  onClick={() => {
                    if (window.confirm("Delete this study session?")) deleteSession.mutate(s.id);
                  }}
                >
                  Delete
                </button>
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
  const courses = useCourses();

  if (courses.isPending) return <p className="muted">Loading…</p>;
  if (courses.isError) return <ErrorMessage error={courses.error} />;

  return (
    <section className="page">
      <h1>Study</h1>
      {courses.data.length === 0 ? (
        <p className="empty">
          Add a course first: study time is tracked per course. <Link to="/courses">Go to Courses</Link>
        </p>
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
