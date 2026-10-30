import { Navigate, Route, Routes } from "react-router";

import { useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { ConfirmEmailPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/AccountLinkPages";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { AuthPage } from "./pages/AuthPage";
import { CalendarPage } from "./pages/CalendarPage";
import { CoursesPage } from "./pages/CoursesPage";
import { GradesPage } from "./pages/GradesPage";
import { JoinPage } from "./pages/JoinPage";
import { LandingPage } from "./pages/LandingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { StudyPage } from "./pages/StudyPage";
import { TimerProvider } from "./timer/TimerContext";

/** The front page for visitors; logged-in users go straight to their calendar. */
function Home() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null; // restoring a login: about to redirect, don't flash the landing page
  return isAuthenticated ? <Navigate to="/calendar" replace /> : <LandingPage />;
}

export function App() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      {/* Links from emails: they work logged out, on whatever device opened the email. */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/confirm-email" element={<ConfirmEmailPage />} />

      {/* Everything inside RequireAuth needs a logged-in user. */}
      <Route element={<RequireAuth />}>
        {/* The timer wraps every logged-in page, so it keeps running as you navigate. */}
        <Route
          element={
            <TimerProvider>
              <Layout />
            </TimerProvider>
          }
        >
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/grades" element={<GradesPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
