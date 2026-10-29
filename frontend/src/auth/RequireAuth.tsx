import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "./AuthContext";

/** Route guard: logged-out visitors go to /login, then come back to where they were headed. */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Loading first: on a page refresh the login is still being restored, not missing.
  if (isLoading) return <p className="centered muted">Loading…</p>;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
