// Axis maths for the study charts, in minutes.

// Steps a person would choose for a time axis: never "every 23 minutes".
const NICE_STEPS = [5, 10, 15, 30, 60, 90, 120, 180, 240, 360, 480, 720];

/** Evenly spaced, round tick values from 0 to just above `maxMinutes`, at most ~5 of them. */
export function timeTicks(maxMinutes: number): number[] {
  const max = Math.max(maxMinutes, 30); // an empty week still gets a sensible 0-30m axis
  const step = NICE_STEPS.find((s) => max / s <= 4) ?? Math.ceil(max / 4 / 60) * 60;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return ticks;
}

/**
 * SVG path for a column whose top corners are rounded (the data end) and whose bottom is square
 * (anchored to the baseline). Falls back to a smaller radius for very short columns.
 */
export function roundedTopPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z",
  ].join(" ");
}
