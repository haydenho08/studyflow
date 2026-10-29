import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleUser,
  GraduationCap,
  ListChecks,
  LogOut,
  MonitorSmartphone,
  Timer,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";

import { describeError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "./ConfirmDialog";
import { formatClock, remainingMs } from "../lib/pomodoro";
import { useTimer } from "../timer/TimerContext";
import { BrandMark } from "./Feedback";

const NAV = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/assignments", label: "Assignments", icon: ListChecks },
  { to: "/courses", label: "Courses", icon: BookOpen },
  { to: "/grades", label: "Grades", icon: GraduationCap },
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

/**
 * The account button and its menu: who you are, "Log out", and "Log out everywhere". Built on
 * the native popover attribute, which handles opening, Escape and clicking outside by itself.
 */
function AccountMenu() {
  const { user, logout, logoutEverywhere } = useAuth();
  const confirm = useConfirm();
  const menuRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function endEverySession() {
    menuRef.current?.hidePopover();
    const ok = await confirm({
      title: "Log out everywhere?",
      message:
        "This ends every StudyFlow login on every device, including this one. Use it if you've lost a device or logged in somewhere public.",
      confirmLabel: "Log out everywhere",
      danger: true,
    });
    if (!ok) return;
    try {
      await logoutEverywhere();
    } catch (err) {
      setError(describeError(err));
      menuRef.current?.showPopover();
    }
  }

  return (
    <>
      {/* aria-label: on phones the email is hidden, and the icon alone has no name. */}
      <button
        type="button"
        className="btn btn-ghost btn-sm account-button"
        popoverTarget="account-menu"
        aria-label="Account"
      >
        <CircleUser size={16} aria-hidden="true" />
        <span className="account-email">{user?.email}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id="account-menu" ref={menuRef} popover="auto" className="menu" onToggle={() => setError(null)}>
        <p className="menu-heading">
          <span className="muted">Logged in as</span>
          <strong>{user?.email}</strong>
        </p>
        <button type="button" className="menu-item" onClick={() => void logout()}>
          <LogOut size={16} aria-hidden="true" />
          Log out
        </button>
        <button type="button" className="menu-item" onClick={() => void endEverySession()}>
          <MonitorSmartphone size={16} aria-hidden="true" />
          Log out everywhere
        </button>
        {error && (
          <p className="error menu-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

export function Layout() {
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
          <AccountMenu />
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
