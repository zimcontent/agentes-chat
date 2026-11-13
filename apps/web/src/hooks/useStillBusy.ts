import { useEffect, useState } from "react";

/** Doug: true once `busy` has lasted `after` ms, so a slow job can say it is still working. Resets when busy ends. */
export function useStillBusy(busy: boolean, after = 8000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), after);
    return () => clearTimeout(timer);
  }, [busy, after]);
  return slow;
}
