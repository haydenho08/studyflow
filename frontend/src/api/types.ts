// Friendly names for the types generated from the backend's OpenAPI schema (src/api/schema.ts).
// Never edit schema.ts by hand: change the Pydantic schemas, then run `npm run gen:api`.
import type { components, operations } from "./schema";

type Schemas = components["schemas"];

export type User = Schemas["UserRead"];
export type Token = Schemas["Token"];
export type ServerConfig = Schemas["ServerConfig"];

export type Course = Schemas["CourseRead"];
export type CourseCreate = Schemas["CourseCreate"];
export type CourseUpdate = Schemas["CourseUpdate"];
export type CourseInvite = Schemas["CourseInvite"];
export type InvitePreview = Schemas["InvitePreview"];
export type CourseMember = Schemas["CourseMemberRead"];

export type Assignment = Schemas["AssignmentRead"];
export type AssignmentCreate = Schemas["AssignmentCreate"];
export type AssignmentUpdate = Schemas["AssignmentUpdate"];
export type AssignmentSeriesCreate = Schemas["AssignmentSeriesCreate"];
export type RepeatRule = Schemas["RepeatRule"];
export type AssignmentKind = Schemas["AssignmentKind"];
export type Priority = Schemas["Priority"];
export type Status = Schemas["Status"];

export type StudySession = Schemas["StudySessionRead"];
export type StudySessionCreate = Schemas["StudySessionCreate"];
export type WeekStats = Schemas["WeekStats"];
export type DayStats = Schemas["DayStats"];

export type CalendarFeed = Schemas["CalendarFeed"];

export type CourseGrades = Schemas["CourseGrades"];
export type GradeTarget = Schemas["GradeTarget"];

// Query-string types are generated too (from each endpoint's parameters), so a new or renamed
// filter on the backend shows up here without hand-editing.
type QueryOf<Operation extends keyof operations> = NonNullable<operations[Operation]["parameters"]["query"]>;

/** Query parameters accepted by GET /api/assignments. */
export type AssignmentFilters = QueryOf<"list_assignments_api_assignments_get">;

/** Query parameters accepted by GET /api/study-sessions. */
export type StudySessionFilters = QueryOf<"list_sessions_api_study_sessions_get">;
