import { api } from "./client";
import type {
  Assignment,
  AssignmentCreate,
  AssignmentFilters,
  AssignmentUpdate,
  Course,
  CourseCreate,
  CourseUpdate,
  StudySession,
  StudySessionCreate,
  StudySessionFilters,
  Token,
  User,
  WeekStats,
} from "./types";

export const authApi = {
  register: (email: string, password: string) =>
    api<User>("/api/auth/register", { method: "POST", json: { email, password } }),
  // OAuth2 password flow: form fields named username/password, not JSON.
  login: (email: string, password: string) =>
    api<Token>("/api/auth/login", { method: "POST", form: { username: email, password } }),
  me: () => api<User>("/api/auth/me"),
};

export const coursesApi = {
  list: () => api<Course[]>("/api/courses"),
  create: (body: CourseCreate) => api<Course>("/api/courses", { method: "POST", json: body }),
  update: (id: number, changes: CourseUpdate) =>
    api<Course>(`/api/courses/${id}`, { method: "PATCH", json: changes }),
  remove: (id: number) => api<void>(`/api/courses/${id}`, { method: "DELETE" }),
};

export const assignmentsApi = {
  list: (filters: AssignmentFilters) => api<Assignment[]>("/api/assignments", { query: filters }),
  create: (body: AssignmentCreate) =>
    api<Assignment>("/api/assignments", { method: "POST", json: body }),
  update: (id: number, changes: AssignmentUpdate) =>
    api<Assignment>(`/api/assignments/${id}`, { method: "PATCH", json: changes }),
  remove: (id: number) => api<void>(`/api/assignments/${id}`, { method: "DELETE" }),
};

export const studyApi = {
  list: (filters: StudySessionFilters) =>
    api<StudySession[]>("/api/study-sessions", { query: filters }),
  create: (body: StudySessionCreate) =>
    api<StudySession>("/api/study-sessions", { method: "POST", json: body }),
  remove: (id: number) => api<void>(`/api/study-sessions/${id}`, { method: "DELETE" }),
  week: (start: string, tz: string) => api<WeekStats>("/api/stats/week", { query: { start, tz } }),
};
