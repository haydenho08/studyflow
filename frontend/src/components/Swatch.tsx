import { useDisplayColor } from "../hooks/useDisplayColor";

/** A course's colour dot, using the right shade for the current light/dark theme. */
export function Swatch({ color }: { color: string | undefined }) {
  const display = useDisplayColor();
  return <span className="swatch" style={{ background: color ? display(color) : undefined }} aria-hidden="true" />;
}
