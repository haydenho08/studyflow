import { useState, type FormEvent } from "react";

import { useCourses, useCreateCourse, useDeleteCourse, useUpdateCourse } from "../api/queries";
import type { Course } from "../api/types";
import { ErrorMessage } from "../components/ErrorMessage";
import { Swatch } from "../components/Swatch";
import { COURSE_PALETTE_LIGHT, nextCourseColor } from "../lib/colors";
import { changedFields, isEmpty } from "../lib/diff";

type CourseFormValues = { name: string; code: string; color: string };

const EMPTY_COURSE: CourseFormValues = { name: "", code: "", color: COURSE_PALETTE_LIGHT[0] };

function CourseForm({
  initial = EMPTY_COURSE,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CourseFormValues;
  submitLabel: string;
  onSubmit: (values: CourseFormValues) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const set = (field: keyof CourseFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(values);
      setValues(initial);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="course-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Code</span>
        <input required maxLength={20} placeholder="EECS 1012" value={values.code} onChange={set("code")} />
      </label>
      <label className="field grow">
        <span>Name</span>
        <input
          required
          maxLength={100}
          placeholder="Intro to Computer Science"
          value={values.name}
          onChange={set("name")}
        />
      </label>
      <label className="field">
        <span>Colour</span>
        <input type="color" value={values.color} onChange={set("color")} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <ErrorMessage error={error} />
    </form>
  );
}

function CourseItem({ course }: { course: Course }) {
  const [editing, setEditing] = useState(false);
  const updateCourse = useUpdateCourse();
  const deleteCourse = useDeleteCourse();
  const current: CourseFormValues = { name: course.name, code: course.code, color: course.color };

  if (editing) {
    return (
      <li className="card">
        <CourseForm
          initial={current}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            const changes = changedFields(current, values);
            if (!isEmpty(changes)) await updateCourse.mutateAsync({ id: course.id, changes });
            setEditing(false);
          }}
        />
      </li>
    );
  }

  function handleDelete() {
    const ok = window.confirm(`Delete ${course.code}? This also deletes all of its assignments.`);
    if (ok) deleteCourse.mutate(course.id);
  }

  return (
    <li className="card course-item">
      <Swatch color={course.color} />
      <div className="grow">
        <div className="course-code">{course.code}</div>
        <div className="muted">{course.name}</div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={handleDelete}
        disabled={deleteCourse.isPending}
      >
        Delete
      </button>
      <ErrorMessage error={deleteCourse.error} />
    </li>
  );
}

export function CoursesPage() {
  const courses = useCourses();
  const createCourse = useCreateCourse();

  return (
    <section className="page">
      <h1>Courses</h1>

      <div className="card">
        <h2>Add a course</h2>
        <CourseForm
          // Remount after each add so the form picks up the next unused palette colour.
          key={courses.data?.length ?? 0}
          initial={{ ...EMPTY_COURSE, color: nextCourseColor(courses.data?.map((c) => c.color) ?? []) }}
          submitLabel="Add course"
          onSubmit={(values) => createCourse.mutateAsync(values)}
        />
      </div>

      {courses.isPending ? (
        <p className="muted">Loading…</p>
      ) : courses.isError ? (
        <ErrorMessage error={courses.error} />
      ) : courses.data.length === 0 ? (
        <p className="empty">No courses yet. Add your first one above.</p>
      ) : (
        <ul className="list">
          {courses.data.map((course) => (
            <CourseItem key={course.id} course={course} />
          ))}
        </ul>
      )}
    </section>
  );
}
