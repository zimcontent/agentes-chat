import { cx } from "../cx";
import type { PlanLevel } from "../plan-state";

/** The edge of a 30px logo tile (`.ac-brand--sm`: 10px corners, 4px at its bottom left) centred in 40, from 12 o'clock. */
const EDGE = "M20 5H25A10 10 0 0 1 35 15V25A10 10 0 0 1 25 35H9A4 4 0 0 1 5 31V15A10 10 0 0 1 15 5H20";

/**
 * How full a plan is, as an outline around its maker's logo (`ProviderLogo` `sm`) in a 40px tile: the logo's own
 * edge, filled clockwise from the top by `used` (0 to 100) over a hairline track. Green while there is room, amber
 * from 80%, red from 90% and at the limit (`planLevel`). For the eye only: the tile says the numbers in its name and
 * its tip. Its parent is positioned and 40px square.
 */
export function UsageRing({ used, level, className }: { used: number; level: PlanLevel; className?: string }) {
  const value = Math.min(100, Math.max(0, used));
  return (
    <svg className={cx("ac-usagering", className)} data-level={level} viewBox="0 0 40 40" aria-hidden="true">
      <path className="ac-usagering__track" d={EDGE} />
      {value > 0 && (
        <path
          className="ac-usagering__fill"
          d={EDGE}
          pathLength={100}
          // A sliver still shows: under 4 the round caps alone would read as a dot.
          strokeDasharray={`${Math.max(4, value)} 100`}
        />
      )}
    </svg>
  );
}
