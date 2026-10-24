// React Query hooks: the only place that knows the cache keys and what each change invalidates.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { assignmentsApi, coursesApi } from "./endpoints";
import type { AssignmentFilters, AssignmentUpdate, CourseUpdate } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  courses: ["courses"] as const,
  // Prefix key: invalidating ["assignments"] refreshes every filtered list at once.
  assignments: ["assignments"] as const,
  assignmentList: (filters: AssignmentFilters) => ["assignments", filters] as const,
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
      // The database cascaded the delete to this course's assignments.
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments });
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
