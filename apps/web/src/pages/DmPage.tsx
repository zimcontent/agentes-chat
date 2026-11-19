import type { DmTarget } from "@dougbot/client";
import { addDm } from "@dougbot/client";
import { audienceNotice, canTalk, seesDetails } from "@dougbot/client/lib/audience";
import { greetingSuggestions } from "@dougbot/client/lib/chat";
import { isGone } from "@dougbot/client/lib/errors";
import { agentGrammar } from "@dougbot/client/lib/grammar";
import { isRightHand, rightHandSeenKey } from "@dougbot/client/lib/right-hand";
import { Avatar, Button, EmptyState } from "@dougbot/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { AudienceChip } from "@/components/AgentAudience";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentSetupIntro, useSetupSteps } from "@/components/AgentSetup";
import { useAgentPanelShown, useOpenAgentPanel } from "@/components/agent-panel-context";
import { ModelPickerButton } from "@/components/ai/ModelPicker";
import { ComputerButton } from "@/components/computer/ComputerDialog";
import { ErrorState } from "@/components/Loading";
import { COMPACT_QUERY, NavToggle, useMediaQuery } from "@/components/NavDrawer";
import { useOrg } from "@/components/org-context";
import { ProfileTrigger } from "@/components/ProfileCard";
import { LetMeTalkButton } from "@/components/ReachLines";
import { RightHandIntro } from "@/components/RightHandIntro";
import { HeaderSearch } from "@/components/search/HeaderSearch";
import { AgentTasksPill } from "@/components/tasks/AgentTasksPanel";
import { useDirectory } from "@/hooks/useDirectory";
import { rightHandSeen } from "@/lib/storage";
import { CallButton } from "@/live-voice/LiveVoice";
import { ChannelPage, ChannelSkeleton, type DmSideControl } from "./ChannelPage";

/** A direct message with an agent or a person: the channel layout with its own header and empty state. */
export function DmPage({ target, focusMessageId }: { target: DmTarget; focusMessageId?: string }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const dir = useDirectory(org.id);
  const kind = "agentId" in target ? "agent" : "person";
  const id = "agentId" in target ? target.agentId : target.userId;
  const dm = useQuery({
    queryKey: ["org", org.id, "dm", kind, id],
    queryFn: async () => {
      const res = await api.dms.open(org.id, target);
      // A DM opened for the first time is in the DM list from its own answer: its search holds to it.
      if (res.dm) addDm(qc, org.id, res.dm);
      return res;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const agent = "agentId" in target ? dir.agentById.get(target.agentId) : undefined;
  const person = "userId" in target ? dir.memberById.get(target.userId) : undefined;
  const name = agent?.name ?? person?.name ?? "";
  const rightHand = isRightHand(agent);
  // A new agent's setup checklist (ADR 0155 §2) for whoever sets it up: its greeting and the checklist on top.
  const setup = useSetupSteps(agent).length > 0;
  // Its DM is open, from its row or any other way in: its row's "Novo" goes.
  // A phone keeps the DM's header line to the role (see `sideSays`).
  const compact = useMediaQuery(COMPACT_QUERY);
  useEffect(() => {
    if (rightHand) rightHandSeen.mark(rightHandSeenKey(me.user.id, org.id));
  }, [rightHand, me.user.id, org.id]);

  if (dm.isError) {
    // An old link to an archived agent, or to someone who left: gone, said as the agent's and channel's pages say it.
    const toAgent = "agentId" in target;
    return (
      <main className="shell__main">
        <div className="page page--mid">
          {isGone(dm.error) ? (
            <EmptyState icon={toAgent ? "agent" : "person"}>
              {toAgent ? t("agent.notFound") : t("errors.said.notInWorkspace")}
            </EmptyState>
          ) : (
            <ErrorState error={dm.error} onRetry={() => void dm.refetch()} />
          )}
        </div>
      </main>
    );
  }
  if (!dm.data || dir.loading) return <ChannelSkeleton dm={kind} />;

  const owner = agent?.ownerUserId ? dir.memberById.get(agent.ownerUserId) : undefined;
  const role = agent ? agent.role || `@${agent.handle}` : "";
  // The right hand (ADR 0137) says what it is and whose permissions it acts with, never an owner, nor a model: each
  // person's DM with it thinks with their own AI, shown with its maker's logo in the side panel's Como pensa.
  const agentLine = agent
    ? rightHand
      ? `${t("rightHand.label")} · ${t("rightHand.actsAsYou")}`
      : owner
        ? t("dm.subtitle", { role, owner: owner.name })
        : t("dm.subtitleNoOwner", { role })
    : undefined;
  const header = ({
    onSearch,
    side,
    searching,
  }: {
    onSearch: () => void;
    side: DmSideControl | null;
    searching: boolean;
  }) => {
    // The agent's panel open beside the conversation already shows its owner and how it thinks: the header keeps its role.
    // On a phone the line keeps the role alone too: the rest is one tap away, on the agent's page.
    const sideSays = Boolean(side?.open && side.docked) || compact;
    return (
      <header className="channel__header">
        <NavToggle />
        {/* Who it is with and the header's glyphs: the glyphs go under a name that can't keep its line beside them. */}
        <div className="ac-actline channel__line">
          <DmWho agentId={agent?.id} userId={person?.userId} label={t("profile.of", { name })} tip={agentLine}>
            <div className="dm-who__text">
              {agent ? (
                <AgentAvatar agentId={agent.id} name={agent.name} />
              ) : (
                <Avatar name={name} imageUrl={person?.image} />
              )}
              <h1 className={agent || person ? "channel__title ac-captop" : "channel__title"}>
                <span className="channel__name">{name}</span>
                {agent && <AudienceChip agent={agent} />}
              </h1>
              {agent && (
                <span className="channel__topic" data-right-hand={rightHand || undefined}>
                  {rightHand
                    ? // Doug: a phone keeps the right hand's line to what it is, as it keeps every agent's to its role.
                      // With the rest the line took the whole row and the header's glyphs went under it, a second
                      // row of glass; whose permissions it acts with is one tap away, on its page.
                      compact
                      ? t("rightHand.label")
                      : `${t("rightHand.label")} · ${t("rightHand.actsAsYou")}`
                    : // Doug: with the side panel open beside the chat, its Responsável and Como pensa say the rest.
                      sideSays
                      ? role
                      : owner
                        ? t("dm.subtitle", { role, owner: owner.name })
                        : t("dm.subtitleNoOwner", { role })}
                </span>
              )}
              {person && <span className="channel__topic">{person.email}</span>}
            </div>
          </DmWho>
          <div className="channel__acts">
            {/* Its tasks (ADR 0128), while it has any: they open in the side panel. */}
            {agent && <AgentTasksPill />}
            {/* The sidebar has the computer: only a line of turns waiting for it still shows here. A viewer of its public
              card gets the sidebar's head alone, so the way in stays for one who may still watch the computer. */}
            {/* Doug: the header leaves how it thinks to the side panel's Como pensa while that panel says it (open
              beside the chat, or one tap away on a phone), so the line of glyphs keeps to one row. */}
            {agent && !rightHand && !sideSays && <ModelPickerButton agent={agent} className="channel__brain" />}
            {agent && !rightHand && <ComputerButton agent={agent} queueOnly={side?.docked && seesDetails(agent)} />}
            {/* A voice call with this agent or person (ADR doug-0006). */}
            <CallButton channelId={dm.data.channelId} title={name} agents={agent ? [agent] : []} dmAgent={agent} />
            {/* The same field as a channel's, held to this DM. */}
            <HeaderSearch channelId={dm.data.channelId} onOpen={onSearch} searching={searching} dm />
            {side && (
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="sidebar"
                className="channel__icon dm-side-toggle"
                aria-label={t("agentSide.label")}
                aria-pressed={side.open}
                title={t(side.open ? "agentSide.hide" : "agentSide.show")}
                onClick={side.toggle}
              />
            )}
          </div>
        </div>
      </header>
    );
  };
  return (
    <ChannelPage
      channelId={dm.data.channelId}
      focusMessageId={focusMessageId}
      fallback={{
        id: dm.data.channelId,
        name,
        topic: "",
        visibility: "private",
        isMember: true,
        createdAt: "",
      }}
      chrome={{
        header,
        composerTarget: name,
        ...(rightHand && agent
          ? {
              composerLabel: `${t("channel.composerDm")} · ${t("rightHand.composerHint")}`,
              intro: <RightHandIntro agent={agent} channelId={dm.data.channelId} />,
            }
          : setup && agent
            ? { intro: <AgentSetupIntro agent={agent} /> }
            : {}),
        dmAgentId: agent?.id,
        dmPersonId: person?.userId,
        locked:
          agent && !canTalk(agent)
            ? audienceNotice(t, agent, (uid) => dir.memberById.get(uid)?.name, dir.roleName)
            : undefined,
        lockedAction: agent ? <LetMeTalkButton agent={agent} /> : undefined,
        emptyText: agent ? t("dm.emptyAgent", agentGrammar(agent.name)) : undefined,
        emptyTitle: agent ? t("chat.sayHiAgent", agentGrammar(agent.name)) : t("chat.sayHiPerson", { name }),
        suggestions: agent ? greetingSuggestions(t, agent.role) : [],
      }}
    />
  );
}

/**
 * Who the DM is with, as one button: an agent's page in the panel beside the conversation, a person's profile card
 * (as their name in a message opens). The button lies over the face and lines so the name stays the page's heading.
 */
function DmWho({
  agentId,
  userId,
  label,
  tip,
  children,
}: {
  agentId?: string;
  userId?: string;
  label: string;
  /** The agent's line whole: under the name it keeps one line and may end in "…". */
  tip?: string;
  children: ReactNode;
}) {
  const openPanel = useOpenAgentPanel();
  const shown = useAgentPanelShown();
  return (
    <div className="dm-who">
      {children}
      {agentId ? (
        <button
          type="button"
          className="profile-trigger dm-who__hit"
          aria-label={label}
          aria-expanded={shown === agentId}
          title={tip}
          onClick={() => openPanel?.(agentId)}
        />
      ) : userId ? (
        <ProfileTrigger actor={{ type: "person", id: userId }} label={label} className="dm-who__hit">
          {null}
        </ProfileTrigger>
      ) : null}
    </div>
  );
}
