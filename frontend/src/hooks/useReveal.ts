import { useEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * Fades `.reveal` elements inside `root` in as they scroll into view (styles in styles.css).
 * Nothing is hidden until this runs, so without JS or IntersectionObserver the page just shows.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target); // reveal once; don't fade out again on the way back up
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    el.querySelectorAll(".reveal").forEach((target) => observer.observe(target));
    el.classList.add("reveal-ready");
    return () => {
      observer.disconnect();
      el.classList.remove("reveal-ready");
    };
  }, [root]);
}

function subscribeToScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

/** True once the page has scrolled past `offset` pixels (for a header shadow, say). */
export function useScrolledPast(offset: number) {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > offset,
    () => false,
  );
}
