// Assignment filters live in the URL (?course=3&status=todo&from=2026-11-01), so a filtered view
// survives a refresh, works with the back button, and can be bookmarked.
import type { AssignmentFilters, AssignmentKind, Priority, Status } from "../api/types";
import { localDayStart } from "./dates";
import { KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "./labels";

/** Return `value` if it is one of the keys of `labels`, otherwise undefined. */
function oneOf<T extends string>(value: string | null, labels: Record<T, string>): T | undefined {
  // hasOwn, not `in`: "toString" in {} is true via the prototype.
  return value !== null && Object.hasOwn(labels, value) ? (value as T) : undefined;
}

function positiveInt(value: string | null): number | undefined {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : undefined;
}

function isoDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/** The URL's raw values, validated. Junk in the URL is ignored rather than sent to the API. */
export interface FilterParams {
  course?: number;
  status?: Status;
  priority?: Priority;
  kind?: AssignmentKind;
  from?: string; // "YYYY-MM-DD", inclusive
  to?: string; // "YYYY-MM-DD", inclusive (the whole day counts)
}

export function readFilterParams(params: URLSearchParams): FilterParams {
  return {
    course: positiveInt(params.get("course")),
    status: oneOf<Status>(params.get("status"), STATUS_LABELS),
    priority: oneOf<Priority>(params.get("priority"), PRIORITY_LABELS),
    kind: oneOf<AssignmentKind>(params.get("kind"), KIND_LABELS),
    from: isoDate(params.get("from")),
    to: isoDate(params.get("to")),
  };
}

/** URL filters -> API query. Dates become local-midnight instants; `to` becomes an exclusive bound. */
export function toApiFilters(filters: FilterParams): AssignmentFilters {
  return {
    course_id: filters.course,
    status: filters.status ? [filters.status] : undefined, // the API takes a list (OR)
    priority: filters.priority,
    kind: filters.kind,
    due_from: filters.from ? localDayStart(filters.from) : undefined,
    // "to Nov 7" means through the end of Nov 7, i.e. before midnight starting Nov 8.
    due_to: filters.to ? localDayStart(filters.to, 1) : undefined,
  };
}
