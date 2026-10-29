// Wording for the grade tracker. The numbers themselves come from the API (app/grades.py), which
// does the maths in exact decimals and rounds in the cautious direction.
import type { GradeTarget } from "../api/types";

const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** 81 -> "81%", 66.67 -> "66.67%". The API has already rounded to two places. */
export function formatPercent(value: number): string {
  return `${percentFormat.format(value)}%`;
}

/** What a target means for the student: "79%" (on what's left), "Secured" or "Out of reach". */
export function describeTarget(target: GradeTarget): string {
  if (target.status === "secured") return "Secured";
  if (target.status === "out_of_reach") return "Out of reach";
  return formatPercent(target.needed ?? 0);
}

/** Turn a text box into the API's decimal: "" -> null, " 18.5 " -> "18.5" (sent as a string, so
 *  it reaches the server's Decimal without passing through a float). */
export function decimalOrNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}
