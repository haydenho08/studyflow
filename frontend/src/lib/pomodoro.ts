// Pomodoro timer logic as pure functions of (state, now). No setInterval in here, so it's
// trivially testable, and the UI can re-render as often or as rarely as it likes.
//
// The timer stores *when it started*, not "seconds left". Counting down with setInterval drifts,
// and browsers throttle timers in background tabs to once a minute or less. Computing
// `startedAt + duration - now` is always right, even after the laptop sleeps.

export interface Preset {
  id: string;
  label: string;
  focusMinutes: number;
  breakMinutes: number;
}

export const PRESETS: readonly Preset[] = [
  { id: "classic", label: "25 / 5", focusMinutes: 25, breakMinutes: 5 },
  { id: "long", label: "50 / 10", focusMinutes: 50, breakMinutes: 10 },
];

/** Shortest session the API accepts (1 minute): a shorter "finish early" isn't saved. */
export const MIN_SESSION_MS = 60_000;

export type TimerState =
  | { phase: "idle" }
  | {
      phase: "focus" | "break";
      userId: number; // whose timer this is: survives token expiry, never shown to anyone else
      courseId: number;
      presetId: string;
      startedAt: number; // epoch ms
      durationMs: number;
    };

export type RunningTimer = Exclude<TimerState, { phase: "idle" }>;

export const IDLE: TimerState = { phase: "idle" };

export function findPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

export function startFocus(userId: number, courseId: number, preset: Preset, now: number): RunningTimer {
  return {
    phase: "focus",
    userId,
    courseId,
    presetId: preset.id,
    startedAt: now,
    durationMs: preset.focusMinutes * 60_000,
  };
}

/** The break starts when the focus block was *due* to end, not when we noticed it ended. */
export function startBreak(focus: RunningTimer): RunningTimer {
  const preset = findPreset(focus.presetId);
  return {
    ...focus,
    phase: "break",
    startedAt: focus.startedAt + focus.durationMs,
    durationMs: preset.breakMinutes * 60_000,
  };
}

export function remainingMs(timer: RunningTimer, now: number): number {
  return Math.max(0, timer.startedAt + timer.durationMs - now);
}

export function elapsedMs(timer: RunningTimer, now: number): number {
  return Math.min(timer.durationMs, Math.max(0, now - timer.startedAt));
}

export function isFinished(timer: RunningTimer, now: number): boolean {
  return remainingMs(timer, now) === 0;
}

/** The session to log for a focus block that ran from its start until `endedAt`. */
export function sessionFor(timer: RunningTimer, endedAt: number) {
  return {
    course_id: timer.courseId,
    started_at: new Date(timer.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
  };
}

/** 1499000 -> "25:00" (rounds up, so the display never shows 00:00 while time remains). */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// --- persistence: a refresh or closed tab mid-Pomodoro shouldn't lose the timer ----------------

const STORAGE_KEY = "studyflow.timer";

function isRunningTimer(value: unknown): value is RunningTimer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.phase === "focus" || v.phase === "break") &&
    typeof v.userId === "number" &&
    typeof v.courseId === "number" &&
    typeof v.presetId === "string" &&
    typeof v.startedAt === "number" &&
    typeof v.durationMs === "number"
  );
}

/** The stored timer, if it is well-formed and belongs to `userId`. Anyone else's is ignored. */
export function loadTimer(userId: number | undefined): TimerState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    // Never trust stored data's shape, or that it's yours (shared computers).
    return isRunningTimer(parsed) && parsed.userId === userId ? parsed : IDLE;
  } catch {
    return IDLE;
  }
}

export function saveTimer(state: TimerState): void {
  try {
    if (state.phase === "idle") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the timer still works, it just won't survive a refresh.
  }
}
