import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "./AuthContext";

/** Route guard: logged-out visitors go to /login, then come back to where they were headed. */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (isLoading) return <p className="centered muted">Loading…</p>;
  return <Outlet />;
}
