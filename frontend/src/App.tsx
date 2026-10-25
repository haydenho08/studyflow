import { Navigate, Route, Routes } from "react-router";

import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { AuthPage } from "./pages/AuthPage";
import { CalendarPage } from "./pages/CalendarPage";
import { CoursesPage } from "./pages/CoursesPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StatsPage } from "./pages/StatsPage";
import { StudyPage } from "./pages/StudyPage";
import { TimerProvider } from "./timer/TimerContext";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />

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
          <Route index element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
