import type { AssignmentKind, Priority, Status } from "../api/types";

// Record<Status, string> must have a label for *every* status. If the backend adds one and we
// regenerate the API types, this stops compiling until the UI handles it.
export const STATUS_LABELS: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const KIND_LABELS: Record<AssignmentKind, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  exam: "Exam",
  lab: "Lab",
  project: "Project",
};

/** [value, label] pairs for building <option>s, in declaration order. */
export function optionsOf<T extends string>(labels: Record<T, string>): [T, string][] {
  return Object.entries(labels) as [T, string][];
}
