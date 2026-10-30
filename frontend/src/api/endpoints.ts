import { api } from "./client";
import type {
  Assignment,
  AssignmentCreate,
  AssignmentFilters,
  AssignmentSeriesCreate,
  AssignmentUpdate,
  CalendarFeed,
  Course,
  CourseCreate,
  CourseGrades,
  CourseInvite,
  CourseMember,
  CourseUpdate,
  InvitePreview,
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
  // Ends this device's login (the server reads the refresh cookie).
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  // Ends every login this account has, on every device.
  logoutEverywhere: () => api<void>("/api/auth/logout-all", { method: "POST" }),
  // One-click demo; `tz` makes the demo's "this week" the visitor's week.
  demo: (tz: string) => api<Token>("/api/auth/demo", { method: "POST", json: { tz } }),
};

export const coursesApi = {
  list: () => api<Course[]>("/api/courses"),
  create: (body: CourseCreate) => api<Course>("/api/courses", { method: "POST", json: body }),
  update: (id: number, changes: CourseUpdate) =>
    api<Course>(`/api/courses/${id}`, { method: "PATCH", json: changes }),
  remove: (id: number) => api<void>(`/api/courses/${id}`, { method: "DELETE" }),
  // Sharing (owner only): the invite link, turned on, replaced or off.
  invite: (id: number) => api<CourseInvite>(`/api/courses/${id}/invite`),
  createInvite: (id: number) => api<CourseInvite>(`/api/courses/${id}/invite`, { method: "POST" }),
  removeInvite: (id: number) => api<void>(`/api/courses/${id}/invite`, { method: "DELETE" }),
  members: (id: number) => api<CourseMember[]>(`/api/courses/${id}/members`),
  // Your own id: leave the course. Someone else's (owner only): remove them.
  removeMember: (id: number, userId: number) =>
    api<void>(`/api/courses/${id}/members/${userId}`, { method: "DELETE" }),
};

export const invitesApi = {
  preview: (token: string) => api<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`),
  accept: (token: string) => api<Course>(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" }),
};

export const assignmentsApi = {
  list: (filters: AssignmentFilters) => api<Assignment[]>("/api/assignments", { query: filters }),
  create: (body: AssignmentCreate) =>
    api<Assignment>("/api/assignments", { method: "POST", json: body }),
  update: (id: number, changes: AssignmentUpdate) =>
    api<Assignment>(`/api/assignments/${id}`, { method: "PATCH", json: changes }),
  remove: (id: number) => api<void>(`/api/assignments/${id}`, { method: "DELETE" }),
  // Repeating deadlines: one call creates the whole series.
  createSeries: (body: AssignmentSeriesCreate) =>
    api<Assignment[]>("/api/assignments/series", { method: "POST", json: body }),
  // "This and following" in a series. `tz` is the zone a due-time change is meant in.
  updateFollowing: (id: number, changes: AssignmentUpdate, tz: string) =>
    api<Assignment[]>(`/api/assignments/${id}/following`, { method: "PATCH", json: changes, query: { tz } }),
  removeFollowing: (id: number) => api<void>(`/api/assignments/${id}/following`, { method: "DELETE" }),
};

export const studyApi = {
  list: (filters: StudySessionFilters) =>
    api<StudySession[]>("/api/study-sessions", { query: filters }),
  create: (body: StudySessionCreate) =>
    api<StudySession>("/api/study-sessions", { method: "POST", json: body }),
  remove: (id: number) => api<void>(`/api/study-sessions/${id}`, { method: "DELETE" }),
  week: (start: string, tz: string) => api<WeekStats>("/api/stats/week", { query: { start, tz } }),
};

export const calendarFeedApi = {
  get: () => api<CalendarFeed>("/api/calendar-feed"),
  // Turns the feed on, or swaps its secret URL for a new one.
  create: () => api<CalendarFeed>("/api/calendar-feed", { method: "POST" }),
  remove: () => api<void>("/api/calendar-feed", { method: "DELETE" }),
};

export const gradesApi = {
  list: () => api<CourseGrades[]>("/api/grades"),
};
