import { Link, NavLink, Outlet } from "react-router";

import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          StudyFlow
        </Link>
        <nav className="nav">
          <NavLink to="/assignments">Assignments</NavLink>
          <NavLink to="/courses">Courses</NavLink>
        </nav>
        <div className="account">
          <span className="muted account-email">{user?.email}</span>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
