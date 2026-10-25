// React Query hooks: the only place that knows the cache keys and what each change invalidates.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { assignmentsApi, coursesApi, studyApi } from "./endpoints";
import type { AssignmentFilters, AssignmentUpdate, CourseUpdate, StudySessionFilters } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  courses: ["courses"] as const,
  // Prefix key: invalidating ["assignments"] refreshes every filtered list at once.
  assignments: ["assignments"] as const,
  assignmentList: (filters: AssignmentFilters) => ["assignments", filters] as const,
  sessions: ["study-sessions"] as const,
  sessionList: (filters: StudySessionFilters) => ["study-sessions", filters] as const,
  stats: ["stats"] as const,
  weekStats: (start: string, tz: string) => ["stats", "week", start, tz] as const,
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
    },
  });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assignments }),
  });
}

export function useUpdateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: AssignmentUpdate }) =>
      assignmentsApi.update(id, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assignments }),
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignmentsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assignments }),
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
