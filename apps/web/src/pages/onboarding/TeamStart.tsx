import { dougOrder } from "@agenteschat/client/lib/doug-team";
import { joinNames } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import {
  type AgentAppearance,
  Button,
  Chip,
  Icon,
  Locked,
  playAgentReaction,
  RadioCard,
  RadioGroup,
  Skeleton,
} from "@agenteschat/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { BringOver } from "@/components/BringOver";
import { lookOf } from "@/lib/look";
import type { useTemplate } from "./steps";
import type { TeamSourceState, TeamStartPick } from "./TeamSource";
import "./team-start.css";

/** Between the faces of a row hopping one after another as it is picked. */
const HOP_GAP_MS = 80;

/**
 * How a team with no agents yet starts (ADR 0162, amended 2026-11-11, and docs/adr/doug-0020-time-doug.md): the Doug
 * team first, already picked, with its faces and the sentence saying what it does; then "Start with a ready-made team"
 * (the template for the workspace's business, named, with its agents) and "Start from scratch" (picked on a server
 * older than the Doug team, the step left with the right hand alone, `skip`). The picked row's agents are awake and hop
 * one after another as it is picked, the other's doze; the preview beside the step shows the template's team while it
 * is picked. Enter on a card presses the step's button (the page's `data-enter`).
 */
export function TeamStart({
  orgId,
  state,
  template,
  lodi,
}: {
  orgId: string;
  state: TeamSourceState;
  template: ReturnType<typeof useTemplate>;
  /** The right hand, as the rail shows it. */
  lodi: { name: string; look: AgentAppearance };
}) {
  const { t } = useTranslation();
  const { start, pickStart, skip, link } = state;
  const { chosen, doug } = template;
  const agents = chosen?.team.agents ?? [];
  const dougMembers = doug ? dougOrder(doug.members ?? []) : [];
  // A server older than the Doug team has no card for it: "Start from scratch" is its pick, as it always was.
  const pick: TeamStartPick = doug || start !== "doug" ? start : "scratch";
  const grammar = agentGrammar(lodi.name);
  // A card's faces that hop as it's picked: each answers its own `playAgentReaction`.
  const faces = (card: TeamStartPick) => (i: number) => ({
    state: pick === card ? undefined : ("sleeping" as const),
    reactionKey: `onb-start-${card}-${i}`,
  });
  const templateFace = faces("template");
  const dougFace = faces("doug");
  useHops(pick, agents.length, dougMembers.length, Boolean(doug));
  return (
    <>
      <Locked when={skip.isPending}>
        <div className="onb__answer">
          <RadioGroup<TeamStartPick>
            value={pick}
            onValueChange={pickStart}
            aria-label={t("onboarding.flow.team.start.title")}
            className="onb-start"
          >
            {/* The Doug team, first and already picked (doug-0020): its faces, then its sentence. */}
            {doug && (
              <RadioCard
                value="doug"
                id="onb-start-doug"
                checked={pick === "doug"}
                title={t("onboarding.flow.team.start.doug")}
                aside={
                  <Chip tone="info" className="onb-start__badge">
                    {t("onboarding.flow.team.start.dougBadge")}
                  </Chip>
                }
                description={t("onboarding.flow.team.start.dougText")}
                detail={
                  <span className="onb-start__who">
                    <span className="onb-start__faces">
                      {dougMembers.map((a, i) => (
                        <AgentAvatar
                          key={a.handle}
                          name={a.name}
                          agent={{ name: a.name, handle: a.handle, role: a.role }}
                          size="sm"
                          {...dougFace(i)}
                        />
                      ))}
                    </span>
                    <span className="onb-start__names">
                      {joinNames(
                        dougMembers.map((a) => a.name),
                        t,
                      )}{" "}
                      · {t("onboarding.flow.team.start.dougWho", { count: dougMembers.length })}
                    </span>
                  </span>
                }
              />
            )}
            <RadioCard
              value="template"
              id="onb-start-template"
              checked={pick === "template"}
              title={t("onboarding.flow.team.start.template")}
              description={
                chosen ? (
                  t("onboarding.flow.team.start.templateText", { count: agents.length, template: chosen.name })
                ) : template.failed ? (
                  t("common.loadFailed")
                ) : (
                  <Skeleton width="80%" />
                )
              }
              detail={
                agents.length > 0 && (
                  <span className="onb-start__who">
                    <span className="onb-start__faces">
                      {agents.map((a, i) => (
                        <AgentAvatar
                          key={a.handle}
                          name={a.name}
                          appearance={lookOf(a)}
                          size="sm"
                          {...templateFace(i)}
                        />
                      ))}
                    </span>
                    <span className="onb-start__names">
                      {joinNames(
                        agents.map((a) => a.name),
                        t,
                      )}
                    </span>
                  </span>
                )
              }
            />
            <RadioCard
              value="scratch"
              id="onb-start-scratch"
              checked={pick === "scratch"}
              title={t("onboarding.flow.team.start.scratch")}
              description={t("onboarding.flow.team.start.scratchText", grammar)}
              detail={
                <span className="onb-start__who">
                  <span className="onb-start__faces">
                    <AgentAvatar name={lodi.name} appearance={lodi.look} size="sm" {...faces("scratch")(0)} />
                    <span className="onb-start__seat" aria-hidden="true">
                      <Icon name="plus" size={14} />
                    </span>
                  </span>
                  <span className="onb-start__names">
                    {t("onboarding.flow.team.start.scratchWho", { name: lodi.name })}
                  </span>
                </span>
              }
            />
          </RadioGroup>
          {/* A third way in, for who has another workspace: its agents and connections, without connecting again. */}
          <BringOver orgId={orgId} allowed ask variant="link" label={t("carry.fromOnboarding")} />
        </div>
      </Locked>
      <div className="onb__actions">
        <Button
          variant="primary"
          block
          kbd={["↵"]}
          data-enter=""
          disabled={pick === "template" && !chosen}
          loading={skip.isPending}
          onClick={() => (pick === "doug" ? link.go("who") : pick === "template" ? link.go("template") : skip.mutate())}
        >
          {pick === "doug"
            ? t("onboarding.flow.team.start.dougGo")
            : pick === "template"
              ? t("onboarding.flow.team.start.see")
              : t("onboarding.flow.team.start.scratchGo", grammar)}
        </Button>
      </div>
    </>
  );
}

/**
 * The picked row's agents hop one after another (the agent engine's "up" reaction, as the first question's scene),
 * never on the view's first look: the Doug team comes picked. With reduced motion the reaction only changes the face
 * (the engine's own rule).
 */
function useHops(start: TeamStartPick, count: number, dougCount: number, hasDoug: boolean) {
  const shown = useRef(start);
  useEffect(() => {
    if (shown.current === start) return;
    shown.current = start;
    const faces = start === "template" ? count : start === "doug" && hasDoug ? dougCount : 1;
    const timers = Array.from({ length: faces }, (_, i) =>
      setTimeout(() => playAgentReaction(`onb-start-${start}-${i}`, "up"), i * HOP_GAP_MS),
    );
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [start, count, dougCount, hasDoug]);
}
