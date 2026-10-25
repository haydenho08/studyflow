import { useCallback, useSyncExternalStore } from "react";

import { displayColor } from "../lib/colors";

const query = window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void) {
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Tracks the OS light/dark setting live, like the CSS media query does. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, () => query.matches);
}

/** Returns a function mapping a course's stored colour to the one to draw in the current theme. */
export function useDisplayColor(): (color: string) => string {
  const dark = usePrefersDark();
  return useCallback((color: string) => displayColor(color, dark), [dark]);
}
