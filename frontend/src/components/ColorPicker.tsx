import { Check, Plus } from "lucide-react";

import { useDisplayColor } from "../hooks/useDisplayColor";
import { COURSE_PALETTE_LIGHT } from "../lib/colors";

/**
 * The validated course palette as a row of swatches (a radio group: arrow keys move between
 * them), plus a "custom" swatch that opens the browser's full colour picker.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const display = useDisplayColor();
  const current = value.toUpperCase();
  const isCustom = !COURSE_PALETTE_LIGHT.includes(current as (typeof COURSE_PALETTE_LIGHT)[number]);

  return (
    <fieldset className="color-picker">
      <legend>Colour</legend>
      <div className="swatches">
        {COURSE_PALETTE_LIGHT.map((color, i) => (
          <label key={color} className="swatch-option" title={`Colour ${i + 1}`}>
            <input
              type="radio"
              name="course-colour"
              value={color}
              checked={current === color}
              onChange={() => onChange(color)}
              aria-label={`Colour ${i + 1}`}
            />
            <span style={{ background: display(color) }}>
              {current === color && <Check size={14} strokeWidth={3} aria-hidden="true" />}
            </span>
          </label>
        ))}
        <label className="swatch-option is-custom" title="Custom colour">
          <input
            type="color"
            value={value.toLowerCase()}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            aria-label="Custom colour"
          />
          <span style={isCustom ? { background: display(value) } : undefined}>
            {isCustom ? (
              <Check size={14} strokeWidth={3} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
          </span>
        </label>
      </div>
    </fieldset>
  );
}
