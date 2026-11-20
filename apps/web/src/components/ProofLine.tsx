import type { Message } from "@dougbot/client";
import { type ProofItem, type ProofKind, proofLine, proofOf } from "@dougbot/client/lib/proof";
import { Icon, type IconName, Tip } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMaybeArtifactViewer } from "@/components/artifacts/ArtifactViewer";
import { useInPlace } from "@/components/InPlace";
import { useOrg } from "@/components/org-context";
import { inPlaceClick } from "@/lib/navigate";
import "./proof-line.css";

const ICONS: Record<ProofKind, IconName> = {
  file: "attach",
  image: "image",
  task: "issues",
  link: "link",
  action: "send",
};

/**
 * Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md): under an agent's reply, one quiet line of what its run
 * really delivered (a file, a screenshot, a task, a page, an outside action), each opening what it names. The first
 * few, then "+N", which shows the rest on the same line's wrap. Nothing when the run delivered nothing new.
 */
export function ProofLine({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = proofOf(message.meta);
  if (message.author.type !== "agent" || items.length === 0) return null;
  const { shown, more } = proofLine(items, open);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group inside a message, not a fieldset
    <div className={`proof-line${open ? " proof-line--open" : ""}`} role="group" aria-label={t("deliveryProof.group")}>
      {shown.map((item) => (
        <ProofChip key={`${item.kind}:${item.ref ?? item.label}`} item={item} />
      ))}
      {more > 0 && (
        <button
          type="button"
          className="proof-line__chip proof-line__more tabular"
          aria-label={t("deliveryProof.showAll")}
          onClick={() => setOpen(true)}
        >
          +{more}
        </button>
      )}
    </div>
  );
}

function ProofChip({ item }: { item: ProofItem }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const viewer = useMaybeArtifactViewer();
  const inPlace = useInPlace();
  const label = item.kind === "image" ? item.label || t("deliveryProof.screenshot") : item.label;
  const inner = (
    <>
      <Icon name={ICONS[item.kind]} size={14} />
      <span className="proof-line__t">{label}</span>
    </>
  );
  const chip = (() => {
    if ((item.kind === "file" || item.kind === "image") && item.ref) {
      const id = item.ref;
      return viewer ? (
        <button type="button" className="proof-line__chip" onClick={() => viewer.open(id)}>
          {inner}
        </button>
      ) : (
        <Link to="/org/$orgId/drive" params={{ orgId: org.id }} search={{ artifact: id }} className="proof-line__chip">
          {inner}
        </Link>
      );
    }
    if (item.kind === "task" && item.ref) {
      const number = Number(item.ref);
      return (
        <Link
          to="/org/$orgId/issues/$number"
          params={{ orgId: org.id, number: item.ref }}
          className="proof-line__chip"
          onClick={inPlace ? (e) => inPlaceClick(e, () => inPlace.issue(number)) : undefined}
        >
          {inner}
        </Link>
      );
    }
    if (item.kind === "link" && item.ref)
      return (
        <a href={item.ref} target="_blank" rel="noopener noreferrer" className="proof-line__chip">
          {inner}
        </a>
      );
    return <span className="proof-line__chip proof-line__chip--still">{inner}</span>;
  })();
  return (
    <Tip tip={label} look="ac-msg__tip" button>
      {chip}
    </Tip>
  );
}
