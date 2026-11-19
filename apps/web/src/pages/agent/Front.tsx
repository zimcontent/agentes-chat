import type { Agent } from "@dougbot/client";
import {
  addDm,
  useAgentAccess,
  useAgentDetail,
  useApi,
  useChannels,
  useProposals,
  useRuns,
  useTeam,
} from "@dougbot/client";
import { levelsOf, resourcesOf } from "@dougbot/client/lib/access-levels";
import { workLine } from "@dougbot/client/lib/agent-work";
import { formatPercent, formatTime } from "@dougbot/client/lib/format";
import { agentGrammar } from "@dougbot/client/lib/grammar";
import { can } from "@dougbot/client/lib/permissions";
import { usageShown } from "@dougbot/client/lib/plan-usage";
import { agentFaceWord, agentStatusText } from "@dougbot/client/lib/presence";
import { pendingOnAgent } from "@dougbot/client/lib/proposals";
import { supervisorOf } from "@dougbot/client/lib/team-views";
import { excerpt } from "@dougbot/client/lib/text";
import {
  BrainIcon,
  Button,
  Card,
  cx,
  GroupHeading,
  Icon,
  type IconName,
  Menu,
  MenuItem,
  Meter,
  ProviderLogo,
} from "@dougbot/ui";
import { planState } from "@dougbot/ui/plan-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { resourceName, useConnectedById } from "@/components/AccessLevels";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentSetupCard } from "@/components/AgentSetup";
import { useOpenAgentPanel } from "@/components/agent-panel-context";
import { ModelPickerDialog } from "@/components/ai/ModelPicker";
import { useOpenComputer } from "@/components/computer/open";
import { NoAiChip } from "@/components/NoAi";
import { useOrg } from "@/components/org-context";
import { UsageQueueChip } from "@/components/UsageQueue";
import { useAgentThinks } from "@/hooks/useAgentThinks";
import { useDirectory } from "@/hooks/useDirectory";
import { useAgentPresence } from "@/hooks/usePresence";
import type { AgentSection, AgentTab } from "@/lib/agent-edit";
import { useOpenParam } from "@/lib/open-param";
import { useToast } from "@/lib/toast";
import { HandsetIcon } from "@/live-voice/icons";
import { NeedsKeyDialog, useLiveVoiceActions } from "@/live-voice/LiveVoice";
import { OLD_LINKS } from "./ComputerNow";
import { RunIcon } from "./pieces";
import "./front.css";

/** How many of what it may use show by name before "+N". */
const USES_NAMED = 3;

/** How many of today's tasks the page lists; the rest are in Atividade. */
const TODAY_SHOWN = 5;

const sameDay = (iso: string, now = new Date()) => new Date(iso).toDateString() === now.toDateString();

/**
 * The agent's page as it opens (docs/adr/doug-0017-agents-lean.md): who it is and how it is now, three ways to act
 * (Ligar, Tarefas, Ajustes), what it may use, its month, who it answers to, the AI it thinks with and its day. Every
 * setting is one click deeper, in Ajustes (`onOpen`, the tabbed page); its AI changes in place, in the model picker.
 */
export function AgentFront({
  agent,
  onOpen,
  panel,
}: {
  agent: Agent;
  /** Opens Ajustes at a tab (and a section of Configurações). */
  onOpen: (tab: AgentTab, section?: AgentSection) => void;
  /** Beside its conversation: no "Conversar", the conversation is next to it. */
  panel?: boolean;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const dir = useDirectory(org.id);
  const viewer = can(org, "manage_agents") ? "admin" : agent.ownerUserId === me.user.id ? "owner" : "member";
  const detail = useAgentDetail(org.id, agent.id);
  const channels = useChannels(org.id);
  const home = (detail.data?.channels ?? [])[0];
  // `?computer=1` (and the older `?browser=1`, `?desktop=1`, `?terminal=1` of notifications and the Mac app's tray)
  // opens its computer here too, once.
  const openComputer = useOpenComputer();
  const [asked, clearAsked] = useOpenParam("computer", OLD_LINKS);
  useEffect(() => {
    if (asked === null) return;
    openComputer(agent.id);
    clearAsked(null);
  }, [asked, clearAsked, openComputer, agent.id]);
  return (
    <div className={cx("page page--full agf", panel && "agf--panel")}>
      <div className="agf-top">
        {!panel && (
          <Button asChild size="sm">
            <Link to="/org/$orgId/dm/agent/$agentId" params={{ orgId: org.id, agentId: agent.id }}>
              <Icon name="message" size={14} />
              {t("agent.chat")}
            </Link>
          </Button>
        )}
        <Menu
          align="end"
          label={t("agent.moreActions")}
          trigger={<Button size="sm" iconOnly icon="more" aria-label={t("agent.moreActions")} />}
        >
          {home && (
            <MenuItem
              icon="channel"
              onSelect={() =>
                void navigate({ to: "/org/$orgId/c/$channelId", params: { orgId: org.id, channelId: home.id } })
              }
            >
              {t("agent.openIn", { channel: home.name })}
            </MenuItem>
          )}
          <MenuItem icon="book" onSelect={() => onOpen("memory")}>
            {t("agent.viewMemory")}
          </MenuItem>
          {viewer !== "member" && (
            <MenuItem icon="routines" onSelect={() => onOpen("activity")}>
              {t("agent.viewRuns")}
            </MenuItem>
          )}
          <MenuItem
            icon="copy"
            onSelect={() => {
              void navigator.clipboard?.writeText(`@${agent.handle}`).catch(() => {});
              toast.show(t("agentPage.copied", { handle: agent.handle }));
            }}
          >
            {t("agentPage.copyHandle", { handle: agent.handle })}
          </MenuItem>
          <MenuItem icon="settings" onSelect={() => onOpen("settings")}>
            {t("agentFront.settings")}
          </MenuItem>
        </Menu>
      </div>

      <header className="agf-who">
        <AgentAvatar agentId={agent.id} size="xl" name={agent.name} />
        <h1 className="agf-name">{agent.name}</h1>
        {agent.role && <p className="agf-role">{agent.role}</p>}
        <div className="agf-states">
          <AgentState agent={agent} channelName={(id) => channels.data?.find((c) => c.id === id)?.name} />
          <NoAiChip agentId={agent.id} />
          <UsageQueueChip agentId={agent.id} />
        </div>
      </header>

      <div className="agf-acts">
        <CallTile agent={agent} />
        <Tile
          icon="check"
          label={t("agentFront.tasks")}
          onClick={() =>
            void navigate({ to: "/org/$orgId/task-manager", params: { orgId: org.id }, search: { agent: agent.id } })
          }
        />
        <Tile icon="settings" label={t("agentFront.settings")} onClick={() => onOpen("settings")} />
      </div>

      {/* A new agent's checklist (ADR 0155 §2), while something is left: the first thing to do here. */}
      <AgentSetupCard agent={agent} place="profile" />
      <WaitsOnYou agent={agent} viewer={viewer} onMemory={() => onOpen("memory")} />

      <Facts agent={agent} viewer={viewer} onOpen={onOpen} />

      <Today agent={agent} viewer={viewer} ownerFirst={ownerFirstOf(dir, agent)} onAll={() => onOpen("activity")} />
    </div>
  );
}

const ownerFirstOf = (dir: ReturnType<typeof useDirectory>, agent: Agent) =>
  agent.ownerUserId ? (dir.memberById.get(agent.ownerUserId)?.name.split(/\s+/)[0] ?? null) : null;

/** One of the three big actions under the name. */
function Tile({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName | ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="agf-tile" onClick={onClick} disabled={disabled}>
      {typeof icon === "string" ? <Icon name={icon as IconName} size={20} /> : icon}
      <span>{label}</span>
    </button>
  );
}

/** Ligar: a voice call with the agent from its conversation, as the conversation's own call button does. */
function CallTile({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const live = useLiveVoiceActions();
  const [needsKey, setNeedsKey] = useState(false);
  // Its conversation, opened the way the conversation's page opens it (the same query, so it is shared).
  const dm = useQuery({
    queryKey: ["org", org.id, "dm", "agent", agent.id],
    queryFn: async () => {
      const res = await api.dms.open(org.id, { agentId: agent.id });
      if (res.dm) addDm(qc, org.id, res.dm);
      return res;
    },
    staleTime: Number.POSITIVE_INFINITY,
    enabled: Boolean(live),
  });
  if (!live) return null;
  const channelId = dm.data?.channelId;
  const busy = Boolean(live.agentCall && live.agentCall.getState().phase !== "ended");
  return (
    <>
      <Tile
        icon={<HandsetIcon />}
        label={t("agentFront.call")}
        disabled={!channelId || busy}
        onClick={() => {
          if (!channelId) return;
          if (!live.available) setNeedsKey(true);
          else live.callAgent(agent.id, channelId);
        }}
      />
      {needsKey && <NeedsKeyDialog name={agent.name} onClose={() => setNeedsKey(false)} />}
    </>
  );
}

/** How it is now, in one pill: what it works on, what waits on you, or its face's word. */
function AgentState({ agent, channelName }: { agent: Agent; channelName: (id: string) => string | undefined }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const shown = useAgentPresence(agent.id);
  if (!shown || shown.noAi) return null;
  const line = workLine(t, i18n.language, shown.work, { agentName: (id) => dir.agentById.get(id)?.name, channelName });
  const said = shown.line ? agentStatusText(t, shown.line, i18n.language)?.text : null;
  const tone = line?.tone ?? (shown.presence === "working" ? "working" : "neutral");
  const head = line
    ? line.tone === "you"
      ? t("presence.waiting")
      : line.tone === "working"
        ? t("presence.working")
        : upperFirst(line.text)
    : agentFaceWord(t, shown.presence);
  const tail = line?.tone === "working" ? (said ?? line.text) : line?.tone === "you" ? said : null;
  return (
    <span className="agf-state" data-tone={tone} data-presence={shown.presence}>
      <span className="agf-state__dot" aria-hidden="true" />
      <span>{tail ? `${head} · ${tail}` : head}</span>
    </span>
  );
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What waits on someone here: approvals of its runs and the memories it proposes. */
function WaitsOnYou({
  agent,
  viewer,
  onMemory,
}: {
  agent: Agent;
  viewer: "admin" | "owner" | "member";
  onMemory: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const g = agentGrammar(agent.name);
  const detail = useAgentDetail(org.id, agent.id);
  const proposals = useProposals(org.id);
  const approvals = detail.data?.pendingApprovals ?? 0;
  const pending = pendingOnAgent(proposals.data ?? [], agent.id).length;
  if (approvals === 0 && pending === 0) return null;
  return (
    <Card className="agf-waits">
      {approvals > 0 && (
        <div className="agf-wait ac-actline">
          <span className="agf-wait__words ac-iconline">
            <Icon name="lock" size={16} />
            <b>{t("agentPage.overview.approvals", { count: approvals })}</b>
            <span className="muted">
              {viewer === "member" ? t("agentPage.overview.approvalsWait") : t("agentPage.overview.approvalsYou")}
            </span>
          </span>
          <Button asChild size="sm">
            <Link to="/org/$orgId/approvals" params={{ orgId: org.id }}>
              {t("agentPage.overview.seeApprovals")}
            </Link>
          </Button>
        </div>
      )}
      {pending > 0 && (
        <div className="agf-wait ac-actline">
          <span className="agf-wait__words ac-iconline">
            <Icon name="document" size={16} />
            <b>{t("agentPage.overview.proposes", g)}</b>
          </span>
          <Button size="sm" onClick={onMemory}>
            {t("agentPage.overview.review")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Pode usar, Este mês, Responde a and IA: one row each, each opening where it is changed. */
function Facts({
  agent,
  viewer,
  onOpen,
}: {
  agent: Agent;
  viewer: "admin" | "owner" | "member";
  onOpen: (tab: AgentTab, section?: AgentSection) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { org } = useOrg();
  const navigate = useNavigate();
  const access = useAgentAccess(org.id, agent.id);
  const items = useConnectedById();
  const detail = useAgentDetail(org.id, agent.id);
  const team = useTeam(org.id).data?.agents ?? [];
  const thinks = useAgentThinks(agent);

  const resources = access.data ? resourcesOf(access.data) : [];
  const levels = access.data ? levelsOf(access.data) : {};
  const using = resources.filter((r) => (levels[r.id] ?? "none") !== "none");
  const ordered = [...using.filter((r) => r.kind === "connector"), ...using.filter((r) => r.kind === "builtin")];

  const used = detail.data?.budgetUsedPercent ?? 0;
  const shown = usageShown(agent.brain, used);
  const month = shown.plan ? planState(shown.plan.usage).used : used;

  const me = team.find((a) => a.id === agent.id);
  const boss = me ? supervisorOf(me, team) : null;

  const mark = thinks?.mark ? (
    <ProviderLogo id={thinks.mark} size="xs" />
  ) : thinks ? (
    <BrainIcon kind={thinks.kind} size={14} />
  ) : null;
  const picksAi = viewer !== "member";
  const [picking, setPicking] = useState(false);
  const openPanel = useOpenAgentPanel();

  return (
    <Card className="agf-facts">
      <FactRow label={t("agentFront.canUse")} onOpen={() => onOpen("access")} openLabel={t("agentPage.tabs.access")}>
        {access.isLoading ? (
          <span className="muted">…</span>
        ) : ordered.length === 0 ? (
          <span className="muted">{t("agentPage.overview.noConnectors")}</span>
        ) : (
          <span className="agf-chips">
            {ordered.slice(0, USES_NAMED).map((r) => (
              <span key={r.id} className="agf-chip">
                {resourceName(t, r, items)}
              </span>
            ))}
            {ordered.length > USES_NAMED && <span className="agf-chip">+{ordered.length - USES_NAMED}</span>}
          </span>
        )}
      </FactRow>
      <FactRow label={t("agentFront.month")} onOpen={() => onOpen("usage")} openLabel={t("agentPage.tabs.usage")}>
        <span className="agf-month">
          <Meter value={month} max={100} label={t("agentFront.month")} />
          <span className="agf-month__pct ac-num">{formatPercent(locale, month)}</span>
        </span>
      </FactRow>
      <FactRow
        label={t("agentFront.reportsTo")}
        onOpen={() => onOpen("settings", "identity")}
        openLabel={t("team.reportsTo.label")}
      >
        {boss ? (
          <span className="agf-chip">
            <AgentAvatar agentId={boss.id} size="xs" name={boss.name} />
            {boss.name}
          </span>
        ) : (
          <span className="muted">{t("agentFront.reportsToNobody")}</span>
        )}
      </FactRow>
      {thinks?.text && (
        <FactRow
          label={t("agentFront.ai")}
          onOpen={picksAi ? () => setPicking(true) : undefined}
          openLabel={t("aiPanel.change")}
        >
          <span className="agf-chip" title={thinks.text === thinks.short ? undefined : thinks.text}>
            {mark}
            {thinks.short}
          </span>
        </FactRow>
      )}
      {/* The same picker a conversation has; "Mais opções" is the full "Quem pensa" in Ajustes (beside a
          conversation, the picker opens it in the panel by itself). */}
      {picking && (
        <ModelPickerDialog
          agent={agent}
          onClose={() => setPicking(false)}
          onMore={
            openPanel
              ? undefined
              : () =>
                  void navigate({
                    to: "/org/$orgId/agents/$agentId",
                    params: { orgId: org.id, agentId: agent.id },
                    search: { tab: "settings", sec: "brain", brain: "more" },
                  })
          }
        />
      )}
    </Card>
  );
}

/** A row of the facts card: its label, its value and, for who may change it, the way there. */
function FactRow({
  label,
  children,
  onOpen,
  openLabel,
}: {
  label: string;
  children: ReactNode;
  onOpen?: (() => void) | undefined;
  openLabel: string;
}) {
  return (
    <div className="agf-fact">
      <span className="agf-fact__label">{label}</span>
      <span className="agf-fact__value">{children}</span>
      {onOpen && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon="chevronRight"
          aria-label={openLabel}
          title={openLabel}
          onClick={onOpen}
        />
      )}
    </div>
  );
}

/** Hoje: what it did and does today, the newest first; the rest of its work is in Atividade. */
function Today({
  agent,
  viewer,
  ownerFirst,
  onAll,
}: {
  agent: Agent;
  viewer: "admin" | "owner" | "member";
  ownerFirst: string | null;
  onAll: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const runs = useRuns(org.id, agent.id, viewer !== "member");
  const today = (runs.data ?? []).filter((r) => sameDay(r.createdAt));
  const stateOf = (r: (typeof today)[number]) =>
    r.status === "failed"
      ? t("agentFront.failed")
      : r.finishedAt
        ? t("agentFront.doneAt", { time: formatTime(i18n.language, r.finishedAt) })
        : r.status === "waiting_approval" || r.status === "waiting_input"
          ? t("presence.waiting")
          : t("agentFront.going");
  return (
    <section className="agf-today" aria-labelledby="agf-today">
      <GroupHeading
        id="agf-today"
        title={t("agentFront.today")}
        aside={
          viewer !== "member" && today.length > TODAY_SHOWN ? (
            <Button variant="link" onClick={onAll}>
              {t("agentPage.overview.seeAll")}
            </Button>
          ) : undefined
        }
      />
      <Card className="agf-today__card">
        {viewer === "member" ? (
          <p className="small muted">
            {t("agentPage.activity.hidden", { owner: ownerFirst ?? t("roles.adminLower") })}
          </p>
        ) : runs.isLoading ? (
          <p className="small muted">…</p>
        ) : today.length === 0 ? (
          <p className="small muted">{t("agentFront.todayNone")}</p>
        ) : (
          <ul className="agp-list">
            {today.slice(0, TODAY_SHOWN).map((r) => (
              <li key={r.id} className="agp-li ac-faceline">
                <RunIcon run={r} />
                <span className="agp-li__t">
                  <b className="ac-captop">
                    {r.private ? t("agent.runPrivate") : excerpt(r.what, 200) || t("agent.runNoText")}
                  </b>
                  <span>{stateOf(r)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
