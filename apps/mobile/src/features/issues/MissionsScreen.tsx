import { useTranslation } from "react-i18next";
import { RefreshControl } from "react-native";
import { SkeletonList } from "@/ui";
import { ConversationRowView } from "../chats/ConversationRowView";
import { threadRows, threadSections } from "../chats/logic";
import { usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useConversations } from "../shared/queries";
import { RetryLine, TeamSkyEmpty } from "../shared/TeamSkyEmpty";

/** Rows whose agent moves (a long list stays light). */
const LIVE_ROWS = 8;

/**
 * Missões, pushed from Tarefas (ADR doug-0018): a mission is a task an agent runs with a plan, so it lives with the
 * tasks, not under a list of conversations. Conversas' rows, each with its faint line ("Missão · #produto") over the
 * name and its state as words (amber for what waits on you, the orbit for who works); what ended at the end.
 * Loading: rows of its own shape. Empty: the sky with the team.
 */
export function MissionsScreen() {
  const { t } = useTranslation();
  const list = useConversations();
  const rows = threadSections(threadRows(list.rows)).find((s) => s.key === "missions")?.rows ?? [];
  const pull = usePullRefresh(() => list.refetch());
  return (
    <PushedLargeTitle
      title={t("missions.title")}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {list.loading ? (
        <SkeletonList rows={3} />
      ) : list.failed && rows.length === 0 ? (
        <RetryLine onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <TeamSkyEmpty title={t("mobile.missions.emptyTitle")} text={t("mobile.missions.emptyText")} />
      ) : (
        rows.map((r, i) => <ConversationRowView key={r.key} row={r} divider={i > 0} live={i < LIVE_ROWS} />)
      )}
    </PushedLargeTitle>
  );
}
