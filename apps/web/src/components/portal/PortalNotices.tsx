import type { PortalState } from "@dougbot/client";
import { clockAt } from "@dougbot/client/lib/format";
import { Alert } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { useNow } from "@/hooks/useNow";

/**
 * How fresh what the page shows is (ADR 9001), over the overview and the board: while the portal doesn't answer, the
 * server shows its last good read, so the page says that and when it was read; and it says how many changes (edits,
 * schedules) still wait to reach the portal. Nothing shows while the portal answers and nothing waits.
 */
export function PortalNotices({ state }: { state: PortalState | undefined }) {
  const { t, i18n } = useTranslation();
  const now = useNow(60_000);
  if (!state || (!state.stale && state.queued <= 0)) return null;
  return (
    <div className="portal-notices">
      {state.stale && (
        <Alert>
          {state.readAt
            ? t("portal.stale", { time: clockAt(i18n.language, state.readAt, new Date(now)) })
            : t("portal.staleNoTime")}
        </Alert>
      )}
      {state.queued > 0 && <Alert tone="neutral">{t("portal.queued", { count: state.queued })}</Alert>}
    </div>
  );
}
