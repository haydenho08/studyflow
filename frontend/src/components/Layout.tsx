import { Link, NavLink, Outlet } from "react-router";

import { useAuth } from "../auth/AuthContext";
import { formatClock, remainingMs } from "../lib/pomodoro";
import { useTimer } from "../timer/TimerContext";

/** While a Pomodoro runs, a small countdown in the top bar, visible from every page. */
function TimerPill() {
  const { timer, now } = useTimer();
  if (timer.phase === "idle") return null;
  return (
    <Link to="/study" className={`timer-pill phase-${timer.phase}`} aria-label="Go to the running timer">
      <span className="dot" aria-hidden="true" />
      {timer.phase === "focus" ? "Focus" : "Break"} {formatClock(remainingMs(timer, now))}
    </Link>
  );
}

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
          <NavLink to="/study">Study</NavLink>
          <NavLink to="/stats">Stats</NavLink>
        </nav>
        <div className="account">
          <TimerPill />
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
