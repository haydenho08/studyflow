import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useCourses, useCreateCourse, useDeleteCourse, useUpdateCourse } from "../api/queries";
import type { Course } from "../api/types";
import { ColorPicker } from "../components/ColorPicker";
import { useConfirm } from "../components/ConfirmDialog";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState, SkeletonList } from "../components/Feedback";
import { Swatch } from "../components/Swatch";
import { usePageTitle } from "../hooks/usePageTitle";
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
      <label className="field">
        <span>Name</span>
        <input
          required
          maxLength={100}
          placeholder="Intro to Computer Science"
          value={values.name}
          onChange={set("name")}
        />
      </label>
      <ColorPicker value={values.color} onChange={(color) => setValues((v) => ({ ...v, color }))} />
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
  const confirm = useConfirm();
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

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete ${course.code}?`,
      message: "This also deletes its assignments and logged study time. It can't be undone.",
      confirmLabel: "Delete course",
      danger: true,
    });
    if (ok) deleteCourse.mutate(course.id);
  }

  return (
    <li className="card row-item is-compact">
      <Swatch color={course.color} />
      <div className="row-main">
        <div className="row-title">{course.code}</div>
        <div className="muted row-meta">{course.name}</div>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${course.code}`}
          title="Edit"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          className="icon-btn is-danger"
          onClick={handleDelete}
          disabled={deleteCourse.isPending}
          aria-label={`Delete ${course.code}`}
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <ErrorMessage error={deleteCourse.error} />
    </li>
  );
}

export function CoursesPage() {
  usePageTitle("Courses");
  const courses = useCourses();
  const createCourse = useCreateCourse();

  return (
    <section className="page">
      <div className="page-header">
        <h1>Courses</h1>
      </div>

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
        <SkeletonList rows={3} />
      ) : courses.isError ? (
        <ErrorMessage error={courses.error} />
      ) : courses.data.length === 0 ? (
        <EmptyState icon={<BookOpen size={28} />} title="No courses yet">
          Add the courses you're taking this term. Assignments and study time are tracked per course.
        </EmptyState>
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
