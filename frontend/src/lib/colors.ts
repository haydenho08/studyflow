// Course colours. New courses default to a categorical palette validated (with the dataviz
// validator) for colour-blind separation on our light surface; in dark mode the same eight hues
// are shown at their dark-surface steps, which pass the same checks on --surface (#171e2d).
// Colours a user picks themselves are shown as-is.

export const COURSE_PALETTE_LIGHT = [
  "#2A78D6", // blue
  "#EB6834", // orange
  "#1BAF7A", // aqua
  "#EDA100", // yellow
  "#E87BA4", // magenta
  "#008300", // green
  "#6250D6", // violet
  "#E34948", // red
] as const;

const COURSE_PALETTE_DARK = [
  "#3987E5",
  "#D95926",
  "#199E70",
  "#C98500",
  "#D55181",
  "#008300",
  "#9085E9",
  "#E66767",
] as const;

/** "#RRGGBB" -> OKLab, a colour space where straight-line distance matches perceived difference. */
function toOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; // undo sRGB gamma
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual colour difference (OKLab distance x 100). Below ~15, people struggle to tell them apart. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

const MIN_DISTINCT = 15;

/**
 * Default colour for a new course: the first palette colour (in fixed order, never a random or
 * generated hue) that is clearly different from every colour already in use, including custom
 * colours that merely *look like* a palette colour.
 */
export function nextCourseColor(usedColors: readonly string[]): string {
  const distinct = COURSE_PALETTE_LIGHT.find((candidate) =>
    usedColors.every((used) => colorDistance(candidate, used) >= MIN_DISTINCT),
  );
  if (distinct) return distinct;
  // More courses than the palette can keep apart: reuse in order. The legend, labels and
  // table still identify each course, so colour is never the only cue.
  const used = new Set(usedColors.map((c) => c.toUpperCase()));
  return COURSE_PALETTE_LIGHT.find((c) => !used.has(c)) ?? COURSE_PALETTE_LIGHT[usedColors.length % 8]!;
}

/** The colour to draw: palette colours switch to their dark-surface step in dark mode. */
export function displayColor(color: string, dark: boolean): string {
  if (!dark) return color;
  const index = COURSE_PALETTE_LIGHT.indexOf(color.toUpperCase() as (typeof COURSE_PALETTE_LIGHT)[number]);
  return index === -1 ? color : COURSE_PALETTE_DARK[index]!;
}
