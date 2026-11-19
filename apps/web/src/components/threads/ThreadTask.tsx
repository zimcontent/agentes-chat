import type { ThreadInfo } from "@dougbot/client";
import { useIssue } from "@dougbot/client";
import { STATUS_ICON } from "@dougbot/client/lib/issues";
import { Button } from "@dougbot/ui";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

// The task's dialog lives with the board; loaded on the click, which also keeps the thread's modules out of a cycle.
const IssueDialog = lazy(() => import("@/pages/IssuePage").then((m) => ({ default: m.IssueDialog })));

/**
 * "Tarefa #12" in a thread's header (ADR doug-0018): this conversation is that task's, and a click opens the task
 * over it, in place. Its icon is the task's stage, so the header says where the work is without another chip.
 */
export function ThreadTaskButton({ thread }: { thread: ThreadInfo }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const task = thread.task;
  const [open, setOpen] = useState(false);
  const issue = useIssue(org.id, task?.number ?? 0, open && Boolean(task));
  if (!task) return null;
  const status = t(`issues.status.${task.status}`);
  const label = t("threads.task.open", { number: task.number, status });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={STATUS_ICON[task.status]}
        className="thread-head__task"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        {t("threads.task.button", { number: task.number })}
      </Button>
      {open && issue.data && (
        <Suspense fallback={null}>
          <IssueDialog issue={issue.data} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
