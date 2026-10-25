import { useLayoutEffect, useRef, useState } from "react";

/** Tracks an element's rendered width, so SVG can be laid out in real pixels instead of scaled. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  // useLayoutEffect runs after layout but before the browser paints, so the first frame the
  // user sees already has the measured width (useEffect would paint the fallback first).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    // ...then keep following it as the window or layout changes.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
