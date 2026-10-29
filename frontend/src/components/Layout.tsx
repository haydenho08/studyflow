import { BarChart3, BookOpen, CalendarDays, ListChecks, LogOut, Timer } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router";

import { useAuth } from "../auth/AuthContext";
import { formatClock, remainingMs } from "../lib/pomodoro";
import { useTimer } from "../timer/TimerContext";
import { BrandMark } from "./Feedback";

const NAV = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/assignments", label: "Assignments", icon: ListChecks },
  { to: "/courses", label: "Courses", icon: BookOpen },
  { to: "/study", label: "Study", icon: Timer },
  { to: "/stats", label: "Stats", icon: BarChart3 },
];

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
          <BrandMark />
          StudyFlow
        </Link>
        {/* A top bar on desktop; a fixed bottom tab bar on phones (see styles.css). */}
        <nav className="nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <TimerPill />
          <span className="muted account-email">{user?.email}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            <span className="logout-label">Log out</span>
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
