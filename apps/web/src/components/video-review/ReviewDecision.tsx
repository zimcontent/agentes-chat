import type { ReviewDecisionView } from "@dougbot/client/lib/review-decision";
import { Button, Icon, Popover } from "@dougbot/ui";
import { type ReactNode, useState } from "react";
import { copyText } from "@/lib/context-menu";
import { useReviewWords } from "./words";

/**
 * A decision on a piece in review as people read it: "@Rosa Aprovado: **Title** V1 ⓘ". The review's id stays behind
 * the ⓘ, shown only when it is clicked (with a copy), never on hover: the agent's instructions in the body are for
 * the technical style.
 */
export function ReviewDecisionHead({
  decision,
  mention,
}: {
  decision: ReviewDecisionView;
  mention: (handle: string, key: string) => ReactNode;
}) {
  const w = useReviewWords();
  const [copied, setCopied] = useState(false);
  return (
    <p className="vr-decided">
      {decision.handle ? <>{mention(decision.handle, "who")} </> : null}
      {decision.decision === "approve" ? w.decided.approve : w.decided.changes} <b>{decision.title}</b>{" "}
      {w.version(decision.version)}
      <Popover
        label={w.decided.id}
        side="top"
        onOpenChange={(open) => {
          if (!open) setCopied(false);
        }}
        trigger={
          <button type="button" className="ac-hint vr-decided__id" aria-label={w.decided.id}>
            <Icon name="info" size={14} />
          </button>
        }
      >
        <div className="vr-decided__card">
          <span className="vr-decided__label">{w.decided.id}</span>
          <code className="ac-inlinecode">{decision.id}</code>
          <Button size="sm" variant="ghost" icon="copy" onClick={() => copyText(decision.id, () => setCopied(true))}>
            {copied ? w.decided.copied : w.decided.copy}
          </Button>
        </div>
      </Popover>
    </p>
  );
}
