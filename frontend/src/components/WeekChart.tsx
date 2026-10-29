import { useState, type CSSProperties } from "react";

import type { Course, DayStats } from "../api/types";
import { useDisplayColor } from "../hooks/useDisplayColor";
import { useElementWidth } from "../hooks/useElementWidth";
import { roundedTopPath, timeTicks } from "../lib/chart";
import { formatDuration, parseLocalDate } from "../lib/week";

// Drawn at the container's real pixel width (measured), not scaled from a fixed viewBox:
// scaling would shrink the 12px axis text to ~6px on a phone.
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 40, left: 52 };
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const GAP = 2; // surface-coloured gap between stacked segments

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayOfMonth = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const fullDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });

interface Props {
  days: DayStats[];
  /** Courses in stacking order (bottom first), which is also legend order. */
  courses: Course[];
}

/** Stacked columns: minutes studied per day, split by course. */
export function WeekChart({ days, courses }: Props) {
  const color = useDisplayColor();
  const [active, setActive] = useState<number | null>(null);
  const [plotRef, measured] = useElementWidth<HTMLDivElement>(640);

  const WIDTH = Math.max(measured, 280);
  const BAND = (WIDTH - MARGIN.left - MARGIN.right) / 7;
  const BAR_W = Math.min(24, BAND * 0.5); // thin columns: the rest of the band is air
  // "1h 40m" needs ~46px. In narrower bands the cap labels would collide, so drop them;
  // every value is still in the tooltip and the table view.
  const showValueLabels = BAND >= 46;

  const maxMinutes = Math.max(...days.map((d) => d.total_seconds / 60));
  const ticks = timeTicks(maxMinutes);
  const top = ticks.at(-1)!;
  const y = (minutes: number) => MARGIN.top + PLOT_H - (minutes / top) * PLOT_H;

  const activeDay = active === null ? null : days[active];

  return (
    <div className="chart">
      {courses.length >= 2 && (
        <ul className="legend" aria-label="Courses">
          {courses.map((c) => (
            <li key={c.id}>
              <span className="legend-key" style={{ background: color(c.color) }} aria-hidden="true" />
              {c.code}
            </li>
          ))}
        </ul>
      )}

      <div className="chart-plot" ref={plotRef}>
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label="Study time per day"
        >
          {/* Recessive hairline gridlines + y-axis labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={MARGIN.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {formatDuration(t * 60)}
              </text>
            </g>
          ))}

          {days.map((day, i) => {
            const date = parseLocalDate(day.day);
            const cx = MARGIN.left + BAND * i + BAND / 2;
            const x = cx - BAR_W / 2;
            // Stack in the fixed course order so a colour sits at the same place every day.
            const segments = courses
              .map((c) => ({ course: c, minutes: (day.courses.find((s) => s.course_id === c.id)?.seconds ?? 0) / 60 }))
              .filter((s) => s.minutes > 0);
            let cumulative = 0;
            const label = `${fullDay.format(date)}: ${formatDuration(day.total_seconds)}`;

            return (
              <g
                key={day.day}
                className="column"
                style={{ "--i": i } as CSSProperties} // staggers the grow-in animation by day
                tabIndex={0}
                role="img"
                aria-label={label}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                {/* The whole day's band is the hit target, not just the thin bar. */}
                <rect className="hit" x={MARGIN.left + BAND * i} y={MARGIN.top} width={BAND} height={PLOT_H} />
                {/* One group per stack, so the whole bar grows from the baseline as one piece. */}
                <g className="bars" style={{ transformOrigin: `0 ${y(0)}px` }}>
                  {segments.map((s, j) => {
                    const bottom = y(cumulative);
                    cumulative += s.minutes;
                    const isTop = j === segments.length - 1;
                    const segTop = y(cumulative) + (isTop ? 0 : GAP);
                    const h = Math.max(1, bottom - segTop);
                    return isTop ? (
                      <path key={s.course.id} d={roundedTopPath(x, segTop, BAR_W, h)} fill={color(s.course.color)} />
                    ) : (
                      <rect key={s.course.id} x={x} y={segTop} width={BAR_W} height={h} fill={color(s.course.color)} />
                    );
                  })}
                </g>
                {showValueLabels && day.total_seconds > 0 && (
                  <text className="value-label" x={cx} y={y(cumulative) - 6} textAnchor="middle">
                    {formatDuration(day.total_seconds)}
                  </text>
                )}
                <text className="axis-label" x={cx} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle">
                  {weekday.format(date)}
                </text>
                <text className="axis-label muted-label" x={cx} y={HEIGHT - MARGIN.bottom + 30} textAnchor="middle">
                  {dayOfMonth.format(date)}
                </text>
              </g>
            );
          })}

          <line className="baseline" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0)} y2={y(0)} />
        </svg>

        {activeDay && active !== null && (
          <div
            className="tooltip"
            role="status"
            // Beside the column, not over it, so the hovered bar and its label stay visible.
            // The last two days flip to the left so the tooltip doesn't run off the chart.
            style={
              active < 5
                ? { left: `${((MARGIN.left + BAND * (active + 1)) / WIDTH) * 100}%` }
                : { right: `${(1 - (MARGIN.left + BAND * active) / WIDTH) * 100}%` }
            }
          >
            <div className="tooltip-title">{fullDay.format(parseLocalDate(activeDay.day))}</div>
            {activeDay.total_seconds === 0 ? (
              <div className="muted">No study</div>
            ) : (
              <>
                {courses
                  .filter((c) => activeDay.courses.some((s) => s.course_id === c.id))
                  .map((c) => (
                    <div key={c.id} className="tooltip-row">
                      <span className="tooltip-key" style={{ background: color(c.color) }} aria-hidden="true" />
                      <strong>{formatDuration(activeDay.courses.find((s) => s.course_id === c.id)!.seconds)}</strong>
                      <span className="muted">{c.code}</span>
                    </div>
                  ))}
                {activeDay.courses.length > 1 && (
                  <div className="tooltip-row tooltip-total">
                    <strong>{formatDuration(activeDay.total_seconds)}</strong>
                    <span className="muted">total</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
