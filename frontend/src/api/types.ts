// Friendly names for the types generated from the backend's OpenAPI schema (src/api/schema.ts).
// Never edit schema.ts by hand: change the Pydantic schemas, then run `npm run gen:api`.
import type { components } from "./schema";

type Schemas = components["schemas"];

export type User = Schemas["UserRead"];
export type Token = Schemas["Token"];

export type Course = Schemas["CourseRead"];
export type CourseCreate = Schemas["CourseCreate"];
export type CourseUpdate = Schemas["CourseUpdate"];

export type Assignment = Schemas["AssignmentRead"];
export type AssignmentCreate = Schemas["AssignmentCreate"];
export type AssignmentUpdate = Schemas["AssignmentUpdate"];
export type AssignmentKind = Schemas["AssignmentKind"];
export type Priority = Schemas["Priority"];
export type Status = Schemas["Status"];

/** Query parameters accepted by GET /api/assignments. */
export type AssignmentFilters = {
  course_id?: number;
  status?: Status;
  priority?: Priority;
  kind?: AssignmentKind;
  due_from?: string;
  due_to?: string;
};
