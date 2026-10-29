import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useCreateSession } from "../api/queries";
import { useAuth } from "../auth/AuthContext";
import { setTitleOverride } from "../hooks/usePageTitle";
import type { StudySessionCreate } from "../api/types";
import { playChime, unlockAudio } from "../lib/chime";
import {
  IDLE,
  MIN_SESSION_MS,
  elapsedMs,
  formatClock,
  isFinished,
  loadTimer,
  remainingMs,
  saveTimer,
  sessionFor,
  startBreak,
  startFocus,
  type Preset,
  type RunningTimer,
  type TimerState,
} from "../lib/pomodoro";

interface TimerApi {
  timer: TimerState;
  now: number;
  start: (courseId: number, preset: Preset) => void;
  /** Stop a focus block early and log the time so far (if at least a minute). */
  finishEarly: () => void;
  /** Stop without logging anything (also used to skip a break). */
  cancel: () => void;
  /** A finished session the API hasn't accepted yet, with the error if saving failed. */
  unsaved: StudySessionCreate | null;
  saveError: unknown;
  isSaving: boolean;
  retrySave: () => void;
  dismissUnsaved: () => void;
}

const TimerContext = createContext<TimerApi | null>(null);

/**
 * Lives above the page routes, so the timer keeps running (and logs sessions, and updates the
 * tab title) while you look at other pages.
 */
export function TimerProvider({ children }: { children: ReactNode }) {
  // Mounted only once the user is known (inside RequireAuth), so this reads *their* timer.
  const { user } = useAuth();
  const userId = user?.id;
  const [timer, setTimerState] = useState<TimerState>(() => loadTimer(userId));
  const [now, setNow] = useState(() => Date.now());
  const [unsaved, setUnsaved] = useState<StudySessionCreate | null>(null);
  const { mutate: createSession, error: saveError, isPending: isSaving, reset } = useCreateSession();

  const setTimer = useCallback((next: TimerState) => {
    saveTimer(next);
    setTimerState(next);
  }, []);

  const save = useCallback(
    (session: StudySessionCreate) => {
      setUnsaved(session);
      createSession(session, { onSuccess: () => setUnsaved(null) });
    },
    [createSession],
  );

  // Phase transitions: focus -> (log session) -> break -> idle. Called from the clock tick below,
  // i.e. in response to an external event (time passing), not as an effect reacting to state.
  const handledRef = useRef<number | null>(null);
  const complete = useCallback(
    (finished: RunningTimer, at: number) => {
      // Two ticks can land before React re-renders, and StrictMode mounts effects twice in
      // development. Remember which block we already handled so we never log it twice.
      if (handledRef.current === finished.startedAt) return;
      handledRef.current = finished.startedAt;

      if (finished.phase === "focus") {
        // Log the planned block exactly, even if we only noticed now (tab was asleep, etc.).
        save(sessionFor(finished, finished.startedAt + finished.durationMs));
        const breakTimer = startBreak(finished);
        setTimer(isFinished(breakTimer, at) ? IDLE : breakTimer); // away past the break too? skip it
      } else {
        setTimer(IDLE);
      }
      playChime();
    },
    [save, setTimer],
  );

  // The clock: 4 ticks a second while running. Each tick re-renders (the display is recomputed
  // from timestamps, so a late or throttled tick never drifts) and checks whether the block ended.
  useEffect(() => {
    if (timer.phase === "idle") return;
    const id = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (isFinished(timer, at)) complete(timer, at);
    }, 250);
    return () => window.clearInterval(id);
  }, [timer, complete]);

  // Another tab started or stopped the timer: follow it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "studyflow.timer") setTimerState(loadTimer(userId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  // Show the countdown in the browser tab, so it's visible from other tabs.
  useEffect(() => {
    if (timer.phase === "idle") {
      setTitleOverride(null); // back to the page's own title
      return;
    }
    const label = timer.phase === "focus" ? "Focus" : "Break";
    setTitleOverride(`${formatClock(remainingMs(timer, now))} · ${label} · StudyFlow`);
    // Undo on unmount (e.g. logging out), or the countdown would stay frozen in the tab title.
    return () => setTitleOverride(null);
  }, [timer, now]);

  const start = useCallback(
    (courseId: number, preset: Preset) => {
      unlockAudio(); // inside a click handler, so the browser allows sound later
      const startedAt = Date.now();
      setNow(startedAt);
      if (userId === undefined) return;
      setTimer(startFocus(userId, courseId, preset, startedAt));
    },
    [setTimer, userId],
  );

  const finishEarly = useCallback(() => {
    if (timer.phase !== "focus") return;
    const endedAt = Date.now();
    if (elapsedMs(timer, endedAt) >= MIN_SESSION_MS) save(sessionFor(timer, endedAt));
    setTimer(IDLE);
  }, [timer, save, setTimer]);

  const cancel = useCallback(() => setTimer(IDLE), [setTimer]);

  const retrySave = useCallback(() => {
    if (unsaved) save(unsaved);
  }, [unsaved, save]);

  const dismissUnsaved = useCallback(() => {
    setUnsaved(null);
    reset();
  }, [reset]);

  return (
    <TimerContext.Provider
      value={{
        timer,
        now,
        start,
        finishEarly,
        cancel,
        unsaved,
        saveError,
        isSaving,
        retrySave,
        dismissUnsaved,
      }}
    >
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer(): TimerApi {
  const context = useContext(TimerContext);
  if (!context) throw new Error("useTimer must be used inside <TimerProvider>");
  return context;
}
