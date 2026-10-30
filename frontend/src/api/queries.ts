// React Query hooks: the only place that knows the cache keys and what each change invalidates.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { browserTimeZone } from "../lib/week";
import {
  assignmentsApi,
  calendarFeedApi,
  configApi,
  coursesApi,
  gradesApi,
  invitesApi,
  studyApi,
} from "./endpoints";
import type { AssignmentFilters, AssignmentUpdate, CourseUpdate, StudySessionFilters } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  config: ["config"] as const,
  courses: ["courses"] as const,
  // Prefix key: invalidating ["assignments"] refreshes every filtered list at once.
  assignments: ["assignments"] as const,
  assignmentList: (filters: AssignmentFilters) => ["assignments", filters] as const,
  sessions: ["study-sessions"] as const,
  sessionList: (filters: StudySessionFilters) => ["study-sessions", filters] as const,
  stats: ["stats"] as const,
  // Worked out from the assignments' weights and marks, so every assignment change refreshes it.
  grades: ["grades"] as const,
  weekStats: (start: string, tz: string) => ["stats", "week", start, tz] as const,
  calendarFeed: ["calendar-feed"] as const,
  invite: (courseId: number) => ["courses", courseId, "invite"] as const,
  members: (courseId: number) => ["courses", courseId, "members"] as const,
  invitePreview: (token: string) => ["invites", token] as const,
};

export function useCourses() {
  return useQuery({ queryKey: queryKeys.courses, queryFn: coursesApi.list });
}

export function useCreateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: coursesApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.courses }),
  });
}

export function useUpdateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: CourseUpdate }) =>
      coursesApi.update(id, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.courses }),
  });
}

export function useDeleteCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: coursesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.courses });
      // The database cascaded the delete to this course's assignments and study sessions.
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.grades });
    },
  });
}

function invalidateAssignments(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.assignments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.grades }),
  ]);
}

export function useAssignments(filters: AssignmentFilters) {
  return useQuery({
    queryKey: queryKeys.assignmentList(filters),
    queryFn: () => assignmentsApi.list(filters),
    // Keep showing the old list while a new filter loads, instead of flashing "Loading…".
    placeholderData: keepPreviousData,
  });
}

export function useCreateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignmentsApi.create,
    onSuccess: () => invalidateAssignments(queryClient),
  });
}

export function useCreateSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignmentsApi.createSeries,
    onSuccess: () => invalidateAssignments(queryClient),
  });
}

/** "following": this deadline and the later ones in its series. */
type Scope = "this" | "following";

export function useUpdateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      changes,
      scope = "this",
    }: {
      id: number;
      changes: AssignmentUpdate;
      scope?: Scope;
    }): Promise<unknown> =>
      scope === "following"
        ? assignmentsApi.updateFollowing(id, changes, browserTimeZone())
        : assignmentsApi.update(id, changes),
    onSuccess: () => invalidateAssignments(queryClient),
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope = "this" }: { id: number; scope?: Scope }) =>
      scope === "following" ? assignmentsApi.removeFollowing(id) : assignmentsApi.remove(id),
    onSuccess: () => invalidateAssignments(queryClient),
  });
}

export function useStudySessions(filters: StudySessionFilters) {
  return useQuery({
    queryKey: queryKeys.sessionList(filters),
    queryFn: () => studyApi.list(filters),
  });
}

/** Logging or deleting a session changes both the session lists and every stats view. */
function useInvalidateStudy() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
  };
}

export function useCreateSession() {
  const invalidate = useInvalidateStudy();
  return useMutation({ mutationFn: studyApi.create, onSuccess: invalidate });
}

export function useDeleteSession() {
  const invalidate = useInvalidateStudy();
  return useMutation({ mutationFn: studyApi.remove, onSuccess: invalidate });
}

export function useWeekStats(start: string, tz: string) {
  return useQuery({
    queryKey: queryKeys.weekStats(start, tz),
    queryFn: () => studyApi.week(start, tz),
    placeholderData: keepPreviousData, // keep last week's chart up while the next one loads
  });
}

export function useCalendarFeed(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.calendarFeed, queryFn: calendarFeedApi.get, enabled });
}

/** Turning the feed on, replacing or removing it answers with the new state: no refetch needed. */
export function useCreateCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: calendarFeedApi.create,
    onSuccess: (feed) => queryClient.setQueryData(queryKeys.calendarFeed, feed),
  });
}

export function useDeleteCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: calendarFeedApi.remove,
    onSuccess: () => queryClient.setQueryData(queryKeys.calendarFeed, { path: null }),
  });
}

export function useGrades() {
  return useQuery({ queryKey: queryKeys.grades, queryFn: gradesApi.list });
}

// --- sharing ------------------------------------------------------------------------------------

export function useCourseInvite(courseId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.invite(courseId), queryFn: () => coursesApi.invite(courseId), enabled });
}

export function useCreateInvite(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => coursesApi.createInvite(courseId),
    onSuccess: (invite) => queryClient.setQueryData(queryKeys.invite(courseId), invite),
  });
}

export function useDeleteInvite(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => coursesApi.removeInvite(courseId),
    onSuccess: () => queryClient.setQueryData(queryKeys.invite(courseId), { path: null }),
  });
}

export function useCourseMembers(courseId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.members(courseId), queryFn: () => coursesApi.members(courseId), enabled });
}

/** Leave a course, or (owner) remove someone. Leaving takes your deadlines, grades and study time
 *  for it off every page, so all of those refresh. */
export function useRemoveMember(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => coursesApi.removeMember(courseId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.courses });
      void invalidateAssignments(queryClient);
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useInvitePreview(token: string) {
  return useQuery({ queryKey: queryKeys.invitePreview(token), queryFn: () => invitesApi.preview(token) });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: invitesApi.accept,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.courses });
      void invalidateAssignments(queryClient);
    },
  });
}

/** The server's optional features. They only change with a redeploy, so fetch once. */
export function useServerConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: configApi.get, staleTime: Infinity });
}
