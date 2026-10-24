/**
 * The fields of `edited` whose values differ from `original`: exactly what a PATCH should send.
 * Sending only changes means two people editing different fields don't overwrite each other.
 */
export function changedFields<T extends object>(original: T, edited: T): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(edited) as (keyof T)[]) {
    if (edited[key] !== original[key]) changes[key] = edited[key];
  }
  return changes;
}

export function isEmpty(object: object): boolean {
  return Object.keys(object).length === 0;
}
