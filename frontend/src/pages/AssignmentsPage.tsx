import { BookOpen, ListChecks, Pencil, Plus, Repeat, SearchX, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import {
  useAssignments,
  useCourses,
  useCreateAssignment,
  useCreateSeries,
  useDeleteAssignment,
  useUpdateAssignment,
} from "../api/queries";
import type { Assignment, AssignmentKind, Course, Priority, Status } from "../api/types";
import { useChoose, useConfirm } from "../components/ConfirmDialog";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { Swatch } from "../components/Swatch";
import {
  defaultDueInput,
  formatDue,
  formatRelative,
  fromDateTimeInput,
  toDateTimeInput,
} from "../lib/dates";
import { changedFields, isEmpty } from "../lib/diff";
import { readFilterParams, toApiFilters } from "../lib/filters";
import { decimalOrNull, formatPercent } from "../lib/grades";
import { usePageTitle } from "../hooks/usePageTitle";
import { KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, optionsOf } from "../lib/labels";
import { NO_REPEAT, WEEKDAYS, describeRepeat, toRepeatRule, weekdayOf, type RepeatValues } from "../lib/recurrence";
import { browserTimeZone } from "../lib/week";

// --- form -------------------------------------------------------------------------------------

/** What the inputs hold: strings, in local time. Converted to the API's shape by toPayload. */
type AssignmentFormValues = {
  course_id: string;
  title: string;
  kind: AssignmentKind;
  due: string; // datetime-local value
  priority: Priority;
  description: string;
  // Grade tracking, as typed: "" means not set.
  weight: string;
  score: string;
  outOf: string;
};

function toPayload(values: AssignmentFormValues) {
  return {
    course_id: Number(values.course_id),
    title: values.title.trim(),
    kind: values.kind,
    due_at: fromDateTimeInput(values.due),
    priority: values.priority,
    description: values.description.trim() || null,
    weight: decimalOrNull(values.weight),
    score: decimalOrNull(values.score),
    out_of: decimalOrNull(values.outOf),
  };
}

const asText = (value: number | null) => (value === null ? "" : String(value));

function formValuesFrom(assignment: Assignment): AssignmentFormValues {
  return {
    course_id: String(assignment.course_id),
    title: assignment.title,
    kind: assignment.kind,
    due: toDateTimeInput(assignment.due_at),
    priority: assignment.priority,
    description: assignment.description ?? "",
    weight: asText(assignment.weight),
    score: asText(assignment.score),
    outOf: asText(assignment.out_of),
  };
}

/** "Repeats weekly": which days, how often, and when it ends. Only on the new-assignment form. */
function RepeatFields({
  repeat,
  due,
  onChange,
}: {
  repeat: RepeatValues;
  due: string;
  onChange: (repeat: RepeatValues) => void;
}) {
  const firstDay = due ? weekdayOf(due) : -1;
  const set = <K extends keyof RepeatValues>(field: K, value: RepeatValues[K]) =>
    onChange({ ...repeat, [field]: value });

  function toggle(day: number) {
    const days = repeat.weekdays.includes(day)
      ? repeat.weekdays.filter((d) => d !== day)
      : [...repeat.weekdays, day];
    set("weekdays", days);
  }

  return (
    <fieldset className="repeat span-all">
      <label className="check">
        <input type="checkbox" checked={repeat.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Repeats weekly
      </label>
      {repeat.enabled && (
        <>
          <div className="weekday-picker" role="group" aria-label="Repeat on">
            {WEEKDAYS.map((name, day) => {
              // The first due date's own day is always included (that's where the series starts).
              const fixed = day === firstDay;
              return (
                <button
                  key={name}
                  type="button"
                  className="weekday"
                  aria-pressed={fixed || repeat.weekdays.includes(day)}
                  disabled={fixed}
                  title={fixed ? "The first due date is on this day" : undefined}
                  onClick={() => toggle(day)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="repeat-fields">
            <label className="field">
              <span>Every</span>
              <select value={repeat.everyWeeks} onChange={(e) => set("everyWeeks", Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "week" : `${n} weeks`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Ends</span>
              <select value={repeat.end} onChange={(e) => set("end", e.target.value as RepeatValues["end"])}>
                <option value="count">After a number of deadlines</option>
                <option value="until">On a date</option>
              </select>
            </label>
            {repeat.end === "count" ? (
              <label className="field">
                <span>Deadlines</span>
                <input
                  type="number"
                  required
                  min={2}
                  max={52}
                  value={repeat.count}
                  onChange={(e) => set("count", e.target.value)}
                />
              </label>
            ) : (
              <label className="field">
                <span>Last date</span>
                <input
                  type="date"
                  required
                  min={due.slice(0, 10)}
                  value={repeat.until}
                  onChange={(e) => set("until", e.target.value)}
                />
              </label>
            )}
          </div>
          <p className="muted repeat-summary">
            {describeRepeat(repeat, due)}. Put <code>{"{n}"}</code> in the title to number them:
            &ldquo;Lab {"{n}"}&rdquo; becomes Lab 1, Lab 2…
          </p>
        </>
      )}
    </fieldset>
  );
}

function AssignmentForm({
  courses,
  initial,
  submitLabel,
  repeatable = false,
  onSubmit,
  onCancel,
}: {
  courses: Course[];
  initial: AssignmentFormValues;
  submitLabel: string;
  /** Offer "Repeats weekly" (new assignments only: a series is created all at once). */
  repeatable?: boolean;
  onSubmit: (values: AssignmentFormValues, repeat: RepeatValues) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [repeat, setRepeat] = useState(NO_REPEAT);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof AssignmentFormValues>(field: K, value: AssignmentFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(values, repeat);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="assignment-form" onSubmit={handleSubmit}>
      <label className="field span-2">
        <span>Title</span>
        <input
          required
          maxLength={200}
          placeholder="Lab 3: Recursion"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label className="field">
        <span>Course</span>
        <select required value={values.course_id} onChange={(e) => set("course_id", e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Type</span>
        <select value={values.kind} onChange={(e) => set("kind", e.target.value as AssignmentKind)}>
          {optionsOf(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Due</span>
        <input
          type="datetime-local"
          required
          value={values.due}
          onChange={(e) => set("due", e.target.value)}
        />
      </label>
      <label className="field">
        <span>Priority</span>
        <select
          value={values.priority}
          onChange={(e) => set("priority", e.target.value as Priority)}
        >
          {optionsOf(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Weight (% of course)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          max="100"
          step="0.01"
          placeholder="Optional"
          value={values.weight}
          onChange={(e) => set("weight", e.target.value)}
        />
      </label>
      {/* A series is created before anything is marked: marks are entered one deadline at a time. */}
      {!repeat.enabled && (
        <>
          <label className="field">
            <span>Mark</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Not marked yet"
              value={values.score}
              onChange={(e) => set("score", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Out of</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required={values.score.trim() !== ""}
              value={values.outOf}
              onChange={(e) => set("outOf", e.target.value)}
            />
          </label>
        </>
      )}
      <label className="field span-all">
        <span>Notes (optional)</span>
        <textarea
          rows={2}
          maxLength={5000}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      {repeatable && <RepeatFields repeat={repeat} due={values.due} onChange={setRepeat} />}
      <div className="form-actions span-all">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ErrorMessage error={error} />
    </form>
  );
}

// --- list item --------------------------------------------------------------------------------

function AssignmentItem({ assignment, course, courses }: { assignment: Assignment; course: Course | undefined; courses: Course[] }) {
  const [editing, setEditing] = useState(false);
  const updateAssignment = useUpdateAssignment();
  const deleteAssignment = useDeleteAssignment();
  const confirm = useConfirm();
  const choose = useChoose();
  const inSeries = assignment.series_id !== null;

  /** For a deadline in a repeating series: just this one, or the later ones too? */
  function askScope(action: "change" | "delete") {
    if (action === "change") {
      return choose({
        title: "Change a repeating deadline",
        message:
          "Apply this to only this deadline, or to this one and every later one in the series? To keep later ones numbered, use {n} in the title.",
        choices: [
          { value: "this", label: "Only this one" },
          { value: "following", label: "This and following" },
        ],
      });
    }
    return choose({
      title: `Delete "${assignment.title}"?`,
      message: "It repeats. Delete only this deadline, or this one and every later one? This can't be undone.",
      choices: [
        { value: "this", label: "Only this one", danger: true },
        { value: "following", label: "This and following", danger: true },
      ],
    });
  }

  if (editing) {
    const initial = formValuesFrom(assignment);
    return (
      <li className="card">
        <AssignmentForm
          courses={courses}
          initial={initial}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            // Compare in API shape, so "same instant, different string" doesn't count as a change.
            const changes = changedFields(toPayload(initial), toPayload(values));
            if (!isEmpty(changes)) {
              const scope = inSeries ? await askScope("change") : "this";
              if (scope === null) return; // cancelled: keep editing
              await updateAssignment.mutateAsync({ id: assignment.id, changes, scope });
            }
            setEditing(false);
          }}
        />
      </li>
    );
  }

  const done = assignment.status === "done";
  const overdue = !done && new Date(assignment.due_at) < new Date();

  async function handleDelete() {
    if (inSeries) {
      const scope = await askScope("delete");
      if (scope) deleteAssignment.mutate({ id: assignment.id, scope });
      return;
    }
    const ok = await confirm({
      title: `Delete "${assignment.title}"?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) deleteAssignment.mutate({ id: assignment.id });
  }

  return (
    <li className={`card row-item${done ? " is-done" : ""}${overdue ? " is-overdue" : ""}`}>
      <Swatch color={course?.color} />
      <div className="row-main">
        <div className="row-title">{assignment.title}</div>
        <div className="muted row-meta">
          <span>{course?.code}</span>
          <span>{KIND_LABELS[assignment.kind]}</span>
          {assignment.weight !== null && <span>{formatPercent(assignment.weight)} of grade</span>}
          {inSeries && (
            <span className="repeat-tag" title="Part of a repeating series">
              <Repeat size={13} aria-hidden="true" />
              Repeats
            </span>
          )}
          <time dateTime={assignment.due_at}>
            {formatDue(assignment.due_at)} ({overdue ? "overdue, " : ""}
            {formatRelative(assignment.due_at)})
          </time>
        </div>
        {assignment.description && <p className="description">{assignment.description}</p>}
      </div>
      <div className="row-actions">
        <span className={`badge priority-${assignment.priority}`}>
          {PRIORITY_LABELS[assignment.priority]}
        </span>
        <select
          className={`status-select status-${assignment.status}`}
          aria-label={`Status of ${assignment.title}`}
          value={assignment.status}
          disabled={updateAssignment.isPending}
          onChange={(e) =>
            updateAssignment.mutate({ id: assignment.id, changes: { status: e.target.value as Status } })
          }
        >
          {optionsOf(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${assignment.title}`}
          title="Edit"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          className="icon-btn is-danger"
          onClick={handleDelete}
          disabled={deleteAssignment.isPending}
          aria-label={`Delete ${assignment.title}`}
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <ErrorMessage error={updateAssignment.error ?? deleteAssignment.error} />
    </li>
  );
}

// --- page -------------------------------------------------------------------------------------

export function AssignmentsPage() {
  usePageTitle("Assignments");
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParams = readFilterParams(searchParams);
  const apiFilters = toApiFilters(filterParams);

  const courses = useCourses();
  const assignments = useAssignments(apiFilters);
  const createAssignment = useCreateAssignment();
  const createSeries = useCreateSeries();
  const [adding, setAdding] = useState(false);

  const courseList = courses.data ?? [];
  const courseById = useMemo(() => new Map(courses.data?.map((c) => [c.id, c])), [courses.data]);

  function setFilter(key: string, value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }, // filter tweaks shouldn't each add a history entry
    );
  }

  const hasFilters = [...searchParams.keys()].length > 0;
  const firstCourse = courseList[0];

  return (
    <section className="page">
      <div className="page-header">
        <h1>Assignments</h1>
        {firstCourse && !adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden="true" />
            New assignment
          </button>
        )}
      </div>

      {courses.isSuccess && courseList.length === 0 && (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="Add a course first"
          action={
            <Link to="/courses" className="btn btn-primary">
              Go to Courses
            </Link>
          }
        >
          Every assignment belongs to a course.
        </EmptyState>
      )}

      {adding && firstCourse && (
        <div className="card">
          <h2>New assignment</h2>
          <AssignmentForm
            courses={courseList}
            initial={{
              course_id: String(filterParams.course ?? firstCourse.id),
              title: "",
              kind: "assignment",
              due: defaultDueInput(),
              priority: "medium",
              description: "",
              weight: "",
              score: "",
              outOf: "",
            }}
            submitLabel="Add assignment"
            repeatable
            onCancel={() => setAdding(false)}
            onSubmit={async (values, repeat) => {
              if (repeat.enabled) {
                const rule = toRepeatRule(repeat, values.due, browserTimeZone());
                const series = { ...toPayload(values), score: null, out_of: null, repeat: rule };
                await createSeries.mutateAsync(series);
              } else {
                await createAssignment.mutateAsync(toPayload(values));
              }
              setAdding(false);
            }}
          />
        </div>
      )}

      <div className="toolbar" role="search" aria-label="Filter assignments">
        <label className="field">
          <span>Course</span>
          <select value={filterParams.course ?? ""} onChange={(e) => setFilter("course", e.target.value)}>
            <option value="">All courses</option>
            {courseList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={filterParams.status ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">Any status</option>
            {optionsOf(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select
            value={filterParams.priority ?? ""}
            onChange={(e) => setFilter("priority", e.target.value)}
          >
            <option value="">Any priority</option>
            {optionsOf(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Due from</span>
          <input type="date" value={filterParams.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} />
        </label>
        <label className="field">
          <span>Due to</span>
          <input type="date" value={filterParams.to ?? ""} onChange={(e) => setFilter("to", e.target.value)} />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSearchParams({}, { replace: true })}
          >
            <X size={16} aria-hidden="true" />
            Clear
          </button>
        )}
      </div>

      {assignments.isPending ? (
        <SkeletonList rows={5} />
      ) : assignments.isError ? (
        <ErrorMessage error={assignments.error} />
      ) : assignments.data.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={<SearchX size={28} />} title="Nothing matches these filters">
            Try a different course, status or date range.
          </EmptyState>
        ) : (
          <EmptyState icon={<ListChecks size={28} />} title="No assignments yet">
            {courseList.length > 0 && "Add your first one with New assignment."}
          </EmptyState>
        )
      ) : (
        <ul className={`list${assignments.isPlaceholderData ? " is-stale" : ""}`}>
          {assignments.data.map((a) => (
            <AssignmentItem key={a.id} assignment={a} course={courseById.get(a.course_id)} courses={courseList} />
          ))}
        </ul>
      )}
    </section>
  );
}
