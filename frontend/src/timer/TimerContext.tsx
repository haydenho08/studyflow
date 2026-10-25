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
  const [timer, setTimerState] = useState<TimerState>(loadTimer);
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

  // Re-render 4x a second while running. The displayed time is recomputed from timestamps on
  // every render, so a missed or throttled tick only delays the display, it never drifts.
  useEffect(() => {
    if (timer.phase === "idle") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer.phase]);

  // Another tab started or stopped the timer: follow it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "studyflow.timer") setTimerState(loadTimer());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Phase transitions: focus -> (log session) -> break -> idle.
  const handledRef = useRef<number | null>(null);
  useEffect(() => {
    if (timer.phase === "idle" || !isFinished(timer, now)) return;
    // Effects can run more than once for the same state (React StrictMode does this on purpose
    // in development). Remember which block we already handled so we never log it twice.
    if (handledRef.current === timer.startedAt) return;
    handledRef.current = timer.startedAt;

    if (timer.phase === "focus") {
      // Log the planned block exactly, even if we only noticed now (tab was asleep, etc.).
      save(sessionFor(timer, timer.startedAt + timer.durationMs));
      const breakTimer = startBreak(timer);
      setTimer(isFinished(breakTimer, now) ? IDLE : breakTimer); // away past the break too? skip it
    } else {
      setTimer(IDLE);
    }
    playChime();
  }, [timer, now, save, setTimer]);

  // Show the countdown in the browser tab, so it's visible from other tabs.
  useEffect(() => {
    if (timer.phase === "idle") {
      document.title = "StudyFlow";
      return;
    }
    const label = timer.phase === "focus" ? "Focus" : "Break";
    document.title = `${formatClock(remainingMs(timer, now))} · ${label} · StudyFlow`;
  }, [timer, now]);

  const start = useCallback(
    (courseId: number, preset: Preset) => {
      unlockAudio(); // inside a click handler, so the browser allows sound later
      const startedAt = Date.now();
      setNow(startedAt);
      setTimer(startFocus(courseId, preset, startedAt));
    },
    [setTimer],
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
