import { useEffect } from "react";

// Two things write the browser tab title: each page ("Calendar · StudyFlow") and the running
// Pomodoro ("12:34 · Focus · StudyFlow"). The timer sets an override; clearing it restores
// whichever page is showing, instead of both fighting over document.title.
let pageTitle = "StudyFlow";
let override: string | null = null;

function apply() {
  document.title = override ?? pageTitle;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    pageTitle = `${title} · StudyFlow`;
    apply();
  }, [title]);
}

export function setTitleOverride(value: string | null) {
  override = value;
  apply();
}
