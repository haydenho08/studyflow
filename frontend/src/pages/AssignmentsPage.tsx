import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import {
  useAssignments,
  useCourses,
  useCreateAssignment,
  useDeleteAssignment,
  useUpdateAssignment,
} from "../api/queries";
import type { Assignment, AssignmentKind, Course, Priority, Status } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
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
import { KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, optionsOf } from "../lib/labels";

// --- form -------------------------------------------------------------------------------------

/** What the inputs hold: strings, in local time. Converted to the API's shape by toPayload. */
type AssignmentFormValues = {
  course_id: string;
  title: string;
  kind: AssignmentKind;
  due: string; // datetime-local value
  priority: Priority;
  description: string;
};

function toPayload(values: AssignmentFormValues) {
  return {
    course_id: Number(values.course_id),
    title: values.title.trim(),
    kind: values.kind,
    due_at: fromDateTimeInput(values.due),
    priority: values.priority,
    description: values.description.trim() || null,
  };
}

function formValuesFrom(assignment: Assignment): AssignmentFormValues {
  return {
    course_id: String(assignment.course_id),
    title: assignment.title,
    kind: assignment.kind,
    due: toDateTimeInput(assignment.due_at),
    priority: assignment.priority,
    description: assignment.description ?? "",
  };
}

function AssignmentForm({
  courses,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  courses: Course[];
  initial: AssignmentFormValues;
  submitLabel: string;
  onSubmit: (values: AssignmentFormValues) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
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
      await onSubmit(values);
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
      <label className="field span-all">
        <span>Notes (optional)</span>
        <textarea
          rows={2}
          maxLength={5000}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
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
              await updateAssignment.mutateAsync({ id: assignment.id, changes });
            }
            setEditing(false);
          }}
        />
      </li>
    );
  }

  const done = assignment.status === "done";
  const overdue = !done && new Date(assignment.due_at) < new Date();

  function handleDelete() {
    if (window.confirm(`Delete "${assignment.title}"?`)) deleteAssignment.mutate(assignment.id);
  }

  return (
    <li className={`card assignment-item${done ? " is-done" : ""}${overdue ? " is-overdue" : ""}`}>
      <Swatch color={course?.color} />
      <div className="grow">
        <div className="assignment-title">{assignment.title}</div>
        <div className="muted meta">
          <span>{course?.code}</span>
          <span>{KIND_LABELS[assignment.kind]}</span>
          <time dateTime={assignment.due_at}>
            {formatDue(assignment.due_at)} · {overdue ? "overdue, " : ""}
            {formatRelative(assignment.due_at)}
          </time>
        </div>
        {assignment.description && <p className="description">{assignment.description}</p>}
      </div>
      <span className={`badge priority-${assignment.priority}`}>
        {PRIORITY_LABELS[assignment.priority]}
      </span>
      <select
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
      <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={handleDelete}
        disabled={deleteAssignment.isPending}
      >
        Delete
      </button>
      <ErrorMessage error={updateAssignment.error ?? deleteAssignment.error} />
    </li>
  );
}

// --- page -------------------------------------------------------------------------------------

export function AssignmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParams = readFilterParams(searchParams);
  const apiFilters = toApiFilters(filterParams);

  const courses = useCourses();
  const assignments = useAssignments(apiFilters);
  const createAssignment = useCreateAssignment();
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
            New assignment
          </button>
        )}
      </div>

      {courses.isSuccess && courseList.length === 0 && (
        <p className="empty">
          Add a course first: assignments belong to a course. <Link to="/courses">Go to Courses</Link>
        </p>
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
            }}
            submitLabel="Add assignment"
            onCancel={() => setAdding(false)}
            onSubmit={async (values) => {
              await createAssignment.mutateAsync(toPayload(values));
              setAdding(false);
            }}
          />
        </div>
      )}

      <div className="filters" role="search">
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
          <button type="button" className="btn btn-ghost" onClick={() => setSearchParams({}, { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {assignments.isPending ? (
        <p className="muted">Loading…</p>
      ) : assignments.isError ? (
        <ErrorMessage error={assignments.error} />
      ) : assignments.data.length === 0 ? (
        <p className="empty">{hasFilters ? "Nothing matches these filters." : "No assignments yet."}</p>
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
