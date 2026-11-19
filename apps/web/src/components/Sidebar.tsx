import type {
  Agent,
  AgentGroup,
  AgentSort,
  ApiClient,
  Availability,
  Channel,
  ChannelCategory,
  Member,
  MemberPresence,
  SidebarSection as SectionKey,
  SidebarItem,
} from "@dougbot/client";
import {
  agentStateIn,
  agentWorkingIn,
  MISSIONS_WAITING_COUNT,
  runningAgents,
  useAgentGroups,
  useAgentStatuses,
  useAiAccounts,
  useArchivedChannels,
  useAuthConfig,
  useChannelCategories,
  useChannels,
  useConnections,
  useCreateChannelCategory,
  useDeleteChannelCategory,
  useDms,
  useMachineOutages,
  useMe,
  useMissionList,
  useNotificationCount,
  useOverview,
  usePlaceChannel,
  usePlaceChannelCategory,
  usePrefetchMessages,
  usePrefetchRecent,
  useSidebarItems,
  useSkills,
  useTasksUnread,
  useVideoReviews,
  useWaitingOnMe,
  useWhatsApp,
} from "@dougbot/client";
import { agentSections, groupOf } from "@dougbot/client/lib/agent-groups";
import { WORK_TICK_MS, workLine } from "@dougbot/client/lib/agent-work";
import {
  audienceChip,
  audienceNames,
  audienceNotice,
  canTalk,
  hiddenAgentIds,
  listsAllAgents,
} from "@dougbot/client/lib/audience";
import { channelTitle } from "@dougbot/client/lib/channel-name";
import { workspaceNotes } from "@dougbot/client/lib/deletion";
import { ErrorBoundary } from "@dougbot/client/lib/error-boundary";
import { errorText } from "@dougbot/client/lib/errors";
import { formatTime, upperFirst } from "@dougbot/client/lib/format";
import { waitingAgents } from "@dougbot/client/lib/outages";
import { can, makesAgents, managesChannel } from "@dougbot/client/lib/permissions";
import {
  AVAILABILITIES,
  agentFaceWord,
  isOutOfOffice,
  presenceOfAvailability,
  statusEndNote,
} from "@dougbot/client/lib/presence";
import { recentDms } from "@dougbot/client/lib/recent";
import { isRightHand, rightHandSeenKey } from "@dougbot/client/lib/right-hand";
import { SERVER_PLACE_ICON } from "@dougbot/client/lib/server";
import { inSidebarList, sidebarItemOrder, sidebarPlace } from "@dougbot/client/lib/sidebar-items";
import { AGENT_SORTS, sortAgents, splitPinned } from "@dougbot/client/lib/sidebar-view";
import { setSupportCameFrom, supportContactOf } from "@dougbot/client/lib/support";
import { badgeCount, looksUnread } from "@dougbot/client/lib/unread";
import { isPersonal, modeKey } from "@dougbot/client/lib/workspace-mode";
import {
  type AgentColor,
  Avatar,
  agentGradient,
  Button,
  CountBadge,
  CountChip,
  cx,
  Icon,
  type IconName,
  Kbd,
  Logo,
  Menu,
  MenuCheckboxItem,
  MenuFace,
  MenuHeading,
  MenuItem,
  MenuOverlay,
  MenuOverlayGroup,
  MenuOverlayItem,
  MenuOverlaySeparator,
  MenuRadioGroup,
  MenuSeparator,
  MenuSub,
  modKey,
  OPEN_LAYER,
  PixelSpinner,
  Popover,
  PresenceBadge,
  ProviderLogo,
  RoleMark,
  Skeleton,
  SkeletonGroup,
  selectionSkyUrl,
} from "@dougbot/ui";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useDirectory } from "@/hooks/useDirectory";
import { agentLine, availabilityOf, personLine, useAgentPresence, usePersonPresence } from "@/hooks/usePresence";
import { useServerPlace } from "@/hooks/useServerPlace";
import { useSidebarPins } from "@/hooks/useSidebarPins";
import { useSignOut } from "@/hooks/useSignOut";
import { useUnreadTitle } from "@/hooks/useUnreadTitle";
import { useWorkspaceGroups } from "@/hooks/useWorkspaceGroups";
import { switchAccount } from "@/lib/accounts";
import { requestAgentPanel } from "@/lib/agent-panel-ask";
import { requestChannelDetails } from "@/lib/channel-details";
import type { MenuEntry } from "@/lib/context-menu";
import { onPhoneAsk, takePhoneAsk, thisMac } from "@/lib/desktop";
import { entityMenu } from "@/lib/entity-menu";
import { useOpenParam } from "@/lib/open-param";
import { markOpen } from "@/lib/perf";
import { ownPlanLines, planNearLimit, planWord } from "@/lib/plan-usage";
import { useScrollEdges } from "@/lib/scroll-edges";
import { rightHandSeen, STORAGE_KEYS, sessionStore, storage, storedStrings } from "@/lib/storage";
import { useToast } from "@/lib/toast";
import { offersNewWorkspace, type WorkspaceGroup } from "@/lib/workspaces";
import type { SettingsSection } from "@/pages/settings-sections";
import { useStreams } from "@/realtime/context";
import { EmailDialog, ProfileDialog } from "./AccountSettings";
import { AddPasswordDialog } from "./AddPassword";
import { AgentAvatar } from "./AgentAvatar";
import {
  DeleteGroupDialog,
  type GroupDialogFor,
  GroupMenu,
  GroupNameDialog,
  useAgentDrag,
  useGroupEntries,
  useMoveAgent,
} from "./AgentGroups";
import { AgentWorkLine } from "./AgentWorkLine";
import { AgoraButton } from "./Agora";
import { ArchivedChannelsDialog } from "./ArchivedChannelsDialog";
import { ChangeAvatarDialog } from "./AvatarBuilder";
import { MoveChannelDialog, NewCategoryDialog, RenameCategoryDialog } from "./ChannelCategoryDialogs";
import { openPalette } from "./CommandMenu";
import { DeleteAccountDialog } from "./DeleteAccount";
import { MenuEntries } from "./DesktopMenus";
import { useAgentMenu, useChannelMenu, usePersonMenu } from "./entity-menus";
import { useInviteDialog } from "./invite/InviteDialog";
import { useNow } from "./missions/MissionBits";
import { COMPACT_QUERY, useMediaQuery, useNavDrawer } from "./NavDrawer";
import { NewChannelDialog } from "./NewChannelDialog";
import { useNewAgent } from "./new-agent/NewAgentDialog";
import { OpenOnPhoneDialog } from "./OpenOnPhone";
import { useOrg } from "./org-context";
import { StatusLine } from "./Presence";
import { ChannelPhoto, MyFace, OrgMark } from "./ProfilePhoto";
import { sectionName, useSectionOrder } from "./SidebarOrder";
import {
  SIDEBAR_TOOLS,
  SidebarSetupDialog,
  ToolList,
  toolsHere,
  useHiddenTools,
  useMediaOn,
  usePortalOn,
} from "./SidebarSetup";
import { AgentGlow, AgentTrail, colorOf, WorkspaceSky } from "./Sky";
import { SetStatusDialog, useSaveStatus } from "./StatusDialog";
import {
  closeTabletSidebar,
  NEW_CHANNEL_EVENT,
  TABLET_QUERY,
  toggleSidebar,
  useSidebarCollapsed,
} from "./shell-events";
import { useReviewWords } from "./video-review/words";
import { WhatsAppMark } from "./whatsapp/WhatsAppMark";

/** An agent's sky for its busy chip (`.sidebar__busy`): both themes, the CSS picks one. */
const selectionSky = (color: AgentColor) =>
  ({ "--sel-sky": selectionSkyUrl(color), "--sel-sky-dark": selectionSkyUrl(color, true) }) as CSSProperties;

/** Sidebar rows loading: an icon (or avatar) and a name bar, at the real row height. */
function SidebarSkeleton({ count, avatar, label }: { count: number; avatar?: boolean; label: string }) {
  return (
    <SkeletonGroup label={label}>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
        <span key={i} className="sidebar__item sidebar__item--skeleton">
          <Skeleton shape={avatar ? "square" : "block"} width={avatar ? 28 : 16} height={avatar ? 28 : 16} />
          <Skeleton width={[96, 72, 112][i % 3]} />
        </span>
      ))}
    </SkeletonGroup>
  );
}

/** In place of an agent's or a person's row that failed to draw (`ErrorBoundary`): the rest of the sidebar works. */
function UnshownRow() {
  const { t } = useTranslation();
  return (
    <span className="sidebar__item sidebar__item--unshown" title={t("shell.unshown")}>
      <Icon name="alert" />
      <span className="sidebar__item-label">{t("shell.unshown")}</span>
    </span>
  );
}
export const unshownRow = () => <UnshownRow />;

// Doug: these live in shell-events.ts, so the shell can use them without loading the sidebar (see there).
export { closeTabletSidebar, NEW_CHANNEL_EVENT, TABLET_QUERY, toggleSidebar, useSidebarCollapsed };

/**
 * On the icon rail every channel would be the same "#": its initials instead ("eng-backend" → "Eb",
 * "general" → "Ge"), so the rail still reads which is which.
 */
export function channelInitials(name: string) {
  const words = name
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => Array.from(w));
  const letters = (words.length > 1 ? [words[0]?.[0], words[1]?.[0]] : (words[0] ?? []).slice(0, 2)).join("");
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/**
 * The workspace sidebar. A personal workspace (ADR 0159) has the person on top (their menu, the bell and the collapse
 * beside it), Go to… as the list's first row and no foot; what sits in sight changes, never what can be reached.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const orgId = org.id;
  const personal = isPersonal(org);
  const dir = useDirectory(orgId);
  // No one else is a member (yet, or while the list loads): a personal workspace then lists no people and no #general.
  const alone = !dir.members.some((m) => m.userId !== me.user.id);
  const channels = useChannels(orgId);
  const overview = useOverview(orgId);
  // A new channel: `true` with no category, or the category whose + opened it.
  const [creatingChannel, setCreatingChannel] = useState<boolean | string>(false);
  // A new category: empty, or with the channel whose menu asked for it.
  const [newCategory, setNewCategory] = useState<{ withChannel?: string } | null>(null);
  // Archived channels this person may bring back: "Canais arquivados" in Canais' + while there are some.
  const archivedChannels = useArchivedChannels(orgId).data ?? [];
  const [showArchived, setShowArchived] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const navigate = useNavigate();
  const onProposals = useRouterState({ select: (r) => r.location.pathname.endsWith("/proposals") });
  const onApprovals = useRouterState({ select: (r) => r.location.pathname.endsWith("/approvals") });
  useEffect(() => {
    const open = () => setCreatingChannel(true);
    window.addEventListener(NEW_CHANNEL_EVENT, open);
    return () => window.removeEventListener(NEW_CHANNEL_EVENT, open);
  }, []);
  const proposalsWaiting = overview.data?.proposalsWaitingForMe ?? 0;
  // The bell: unread notifications (live through `notification.counts`); the badge bumps when one arrives.
  const notificationCount = useNotificationCount(orgId).data;
  const unreadNotifications = notificationCount?.unread ?? 0;
  // "Esperando você": everything that waits on me, the same live count (ADR 0172).
  const waitingOnMe = notificationCount?.waiting ?? 0;
  const waitingItems = useWaitingOnMe(orgId).data?.items;
  const lastUnread = useRef(unreadNotifications);
  const [bumps, setBumps] = useState(0);
  useEffect(() => {
    if (unreadNotifications > lastUnread.current) setBumps((b) => b + 1);
    lastUnread.current = unreadNotifications;
  }, [unreadNotifications]);
  // Tarefas: how many open missions wait for me (the server counts: a decision, a review, a suggestion…). Missions
  // live with the tasks (ADR doug-0018).
  const missionList = useMissionList(orgId, MISSIONS_WAITING_COUNT);
  const missionsWaiting = missionList.data?.counts.waitingYou ?? 0;
  // Tarefas: bold for a reply I haven't read in a task's conversation, red for a mention of me there, as a channel.
  const { unread: unreadTasks, mentions: taskMentions } = useTasksUnread(orgId);
  // The tools on top, each where I put it (the rest in More); one there "when there's something" while its count is.
  const sidebarItems = useSidebarItems(orgId).data;
  // Proposals are a tab of Aprovações and count there, unless the person gave them a row of their own.
  const proposalsRow = inSidebarList(sidebarPlace(sidebarItems, "proposals", personal), proposalsWaiting);
  const pending = (overview.data?.approvalsWaitingForMe ?? 0) + (proposalsRow ? 0 : proposalsWaiting);
  // One entry for all of it (ADR 0172 addendum): Aprovações is a tab of "Esperando você", so its count joins this
  // one. An approval I may decide is in both lists and counts once: the approvals, plus what else waits (a question,
  // a secret, a device). Until that list loads, the larger of the two counts.
  const waitingTotal = waitingItems
    ? pending + waitingItems.filter((i) => i.kind !== "approval").length
    : Math.max(waitingOnMe, pending);
  const counts: Partial<Record<SidebarItem, number>> = {
    waiting: waitingTotal,
    approvals: pending,
    proposals: proposalsWaiting,
  };
  // The mode's defaults and order (ADR 0159): in a personal workspace, Routines and Drive in sight, the rest in More.
  // Portal is a tool only where the server has an approval portal (ADR 9001): elsewhere nothing lists it.
  // What an admin took out of the workspace (Settings › General) is gone for everyone, list and More alike.
  const hiddenTools = useHiddenTools();
  const toolOrder = toolsHere(sidebarItemOrder(personal), usePortalOn(), hiddenTools, useMediaOn());
  const listed = toolOrder.filter((id) => inSidebarList(sidebarPlace(sidebarItems, id, personal), counts[id] ?? 0));
  const inMore = toolOrder.filter((id) => !listed.includes(id));
  const countOf = (id: SidebarItem) =>
    id === "waiting" && waitingTotal > 0 ? (
      <CountBadge aria-label={t("notifications.summaryWaiting", { count: waitingTotal })}>
        {badgeCount(waitingTotal)}
      </CountBadge>
    ) : id === "proposals" && proposalsWaiting > 0 ? (
      <CountBadge aria-label={t("shell.pendingProposals", { count: proposalsWaiting })}>{proposalsWaiting}</CountBadge>
    ) : id === "issues" && taskMentions > 0 ? (
      <UnreadCount count={taskMentions} mentions />
    ) : id === "issues" && missionsWaiting > 0 ? (
      // Missions are in Tarefas: the ones waiting for me as a neutral count, after a mention's red one.
      <CountChip
        className="sidebar__count"
        role="img"
        aria-label={t("shell.missionsWaiting", { count: missionsWaiting })}
      >
        {missionsWaiting}
      </CountChip>
    ) : null;
  // The name is on the row: only the rail, which hides it, says it on hover.
  const railTip = (id: SidebarItem | "home") => (rail ? t(`shell.${id}`) : undefined);
  const toolRow = (id: SidebarItem) => (
    <Link
      key={id}
      to={SIDEBAR_TOOLS[id].to}
      params={{ orgId }}
      className="sidebar__item"
      title={railTip(id)}
      data-unread={id === "issues" && unreadTasks > 0}
      // Aprovações and Propostas are tabs of "Esperando você": its row is the one lit on them.
      inactiveProps={
        id === "waiting" && (onApprovals || (onProposals && !proposalsRow)) ? { "data-status": "active" } : undefined
      }
    >
      <Icon name={SIDEBAR_TOOLS[id].icon} />
      <span className="sidebar__item-label">{t(`shell.${id}`)}</span>
      {countOf(id)}
    </Link>
  );
  // Agents waiting for an offline computer: "esperando" instead of anything "working".
  const outages = useMachineOutages(orgId);
  const waitingFor = useMemo(() => waitingAgents(outages.data), [outages.data]);
  // The agents' presence and lines (ADR 0084): the one place that polls them; every face reads the same list. Their
  // work for me, workspace-wide (the addendum of 2026-11-13): who works and who waits, wherever it runs.
  const agentStatuses = useAgentStatuses(orgId).data;
  const workKey = (agentStatuses ?? [])
    .flatMap((s) => (s.work ? [`${s.agentId}:${s.work.state}`] : []))
    .sort()
    .join();
  // The tab's title: "(3) DougBot", what the sidebar's numbers add up to (agents it doesn't list left out).
  const hiddenAgents = useMemo(() => hiddenAgentIds(org, dir.agents), [org, dir.agents]);
  useUnreadTitle(orgId, hiddenAgents);
  const dms = useDms(orgId);
  const dmChannels = new Set((dms.data ?? []).map((d) => d.channelId));
  // Hover or focus loads the conversation before the click.
  const prefetch = usePrefetchMessages(orgId);
  // …and the unread and latest ones as soon as the workspace opens.
  usePrefetchRecent(orgId);
  // The right hand (ADR 0137): the first row of AGENTES; outside its audience, none.
  const rightHand = dir.agents.find((a) => isRightHand(a) && a.canTalk !== false);
  const dmOf = new Map((dms.data ?? []).map((d) => [d.with.id, d]));
  const rightHandDm = rightHand ? dmOf.get(rightHand.id) : undefined;
  // New agent: one dialog for every way in (ADR 0164); outside the shell (a test's page), the full form.
  const newAgentDialog = useNewAgent();
  const newAgent = () =>
    newAgentDialog ? newAgentDialog.open() : void navigate({ to: "/org/$orgId/agents/new", params: { orgId } });
  const sections = useSidebarSections(me.user.id, orgId);
  // "Fixar no topo": a pinned channel sits on top of its section, above a thin line; a pinned agent joins the faces on
  // top. Agents and people otherwise go by their latest message alone (docs/adr/doug-0014-latest-first.md).
  const { view, setView, pins } = useSidebarPins();
  // "Mensagens diretas": the people I talked to or just opened a DM with, latest first (an agent's row in AGENTES is
  // its DM), a pinned one in its place with its mark.
  const directs = recentDms(dms.data ?? [], hiddenAgents).flatMap((d) => {
    const member = d.with.type === "person" ? dir.memberById.get(d.with.id) : undefined;
    return member ? [{ dm: d, member }] : [];
  });
  const directsUnread = directs.reduce((n, x) => n + x.dm.unread, 0);
  // When each agent's DM last spoke, for AGENTES' "latest message first".
  const lastActive = new Map<string, string>();
  for (const d of dms.data ?? [])
    if (d.with.type === "agent" && d.lastMessage) lastActive.set(d.with.id, d.lastMessage.createdAt);

  // Who works now: a run this tab hears, or the agents' list (work handed off in two agents' DM too). Who waits on
  // someone or is in line: a closed group still shows them.
  const busyKey = useStreams((st) => [...runningAgents(st)].sort().join());
  const { busy, waits } = useMemo(() => {
    const work = workKey ? workKey.split(",").map((w) => w.split(":") as [string, string]) : [];
    return {
      busy: new Set([
        ...(busyKey ? busyKey.split(",") : []),
        ...work.flatMap(([id, s]) => (s === "working" ? [id] : [])),
      ]),
      waits: new Set(work.flatMap(([id, s]) => (s === "working" ? [] : [id]))),
    };
  }, [busyKey, workKey]);
  // How many of the workspace's agents are working now: the sky at the bottom rises with it.
  const working = dir.agents.filter((a) => busy.has(a.id)).length;
  // Narrow screens: the sidebar is a drawer (id, open state, close on link / swipe).
  const drawer = useNavDrawer();
  // Desktop: the person can shrink the sidebar to an icon rail (remembered). Tablets start as the rail and open over
  // the page (`float`).
  const compact = useMediaQuery(COMPACT_QUERY);
  const tablet = useMediaQuery(TABLET_QUERY);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const rail = !compact && collapsed;
  const float = tablet && !collapsed;

  // AGENTES (ADR 0083 and its addendum): the agents that talk to me (who manages agents may list the rest), the ones in
  // no group, then each group of agents, each with my pinned ones on top and the rest in my order.
  const manages = can(org, "manage_agents");
  const team = dir.agents.filter((a) => !isRightHand(a));
  // Hidden from my AGENTES (my sidebar view, every device); Ctrl+K still finds them. "Mostrar ocultos" lists them again.
  const hiddenIds = new Set(view.hiddenAgents ?? []);
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = team.filter((a) => hiddenIds.has(a.id)).length;
  const shownAgents = team.filter(
    (a) => ((manages && view.showAllAgents) || canTalk(a)) && (showHidden || !hiddenIds.has(a.id)),
  );
  const hideToast = useToast();
  const hideEntry = (a: Agent): MenuEntry[] => {
    const hidden = hiddenIds.has(a.id);
    return [
      {
        kind: "item",
        id: hidden ? "unhide" : "hide",
        label: t(hidden ? "sidebarAgents.unhide" : "sidebarAgents.hide"),
        icon: hidden ? "eye" : "eyeOff",
        run: () => {
          setView((now) => {
            const current = now.hiddenAgents ?? [];
            return {
              ...now,
              hiddenAgents: hidden
                ? current.filter((id) => id !== a.id)
                : [...current.filter((id) => id !== a.id), a.id],
            };
          });
          if (!hidden) hideToast.show(t("sidebarAgents.hiddenToast", { name: a.name }), "info");
        },
      },
    ];
  };
  const groups = useAgentGroups(orgId).data ?? [];
  const byGroup = agentSections(shownAgents, groups, (a) => a.id);
  const ordered = (items: Agent[]) => sortAgents(items, view.agentSort, me.user.id, busy, lastActive);
  // Doug (after Nordus's pinned hero): up to four agents pinned on top leave the list for a row of big faces under the
  // search. The rail keeps them as rows.
  // DougBot: the right hand (the Doug, the team's chief) always first in the row, fixed; then the pinned ones.
  const pinnedLoose = splitPinned(byGroup.ungrouped, pins.agents, (a) => a.id).top;
  const hero = rail || personal ? [] : [...(rightHand ? [rightHand] : []), ...pinnedLoose].slice(0, HERO_MAX);
  // The list: every agent not among the faces, in the person's order (the latest message first by default). A pin past
  // the faces' four only marks its row: it doesn't move it.
  const loose = ordered(byGroup.ungrouped.filter((a) => !hero.includes(a)));
  // Members never see an empty group; who arranges the agents keeps them, to drop agents in.
  const agentGroups = byGroup.groups.filter((g) => g.items.length > 0 || (manages && g.group.agentIds.length === 0));
  const groupIds = agentGroups.map((g) => `group:${g.group.id}` as SectionId);
  // A long team starts with its groups closed. Closed, a group still shows who works, waits or wrote to me.
  const groupsOpen = shownAgents.length <= 12;
  const organize = manages && !rail;
  const drag = useAgentDrag(groups);
  const moveAgent = useMoveAgent(groups);
  const [groupDialog, setGroupDialog] = useState<GroupDialogFor | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<AgentGroup | null>(null);
  const groupMenuEntries = useGroupEntries();
  const groupChoices = (group: AgentGroup) => ({
    group,
    index: groups.findIndex((g) => g.id === group.id),
    count: groups.length,
    onRename: () => setGroupDialog({ mode: "rename", group }),
    onDelete: () => setDeletingGroup(group),
  });
  const agentsUnread = shownAgents.reduce((n, a) => n + (dmOf.get(a.id)?.unread ?? 0), 0);
  const workingAgents = shownAgents.filter((a) => busy.has(a.id)).length;
  // "Mudar de grupo" in an agent's right click: the keyboard's way to what dragging does.
  const groupEntries = (a: Agent): MenuEntry[] => {
    const current = groupOf(groups, a.id)?.id ?? null;
    const choices = groups.length ? [{ id: null, name: t("agentGroups.none") }, ...groups] : [];
    return [
      { kind: "separator" },
      ...(choices.length ? [{ kind: "header" as const, label: t("sidebarAgents.changeGroup") }] : []),
      ...choices.map(
        (g): MenuEntry => ({
          kind: "item",
          id: `group-${g.id ?? "none"}`,
          label: g.name,
          // The menu's other items have icons: the groups' line up with them. Its own group is dimmed.
          icon: "layers",
          disabled: g.id === current,
          run: () => moveAgent(a.id, g.id),
        }),
      ),
      {
        kind: "item",
        id: "new-group",
        label: t("sidebarAgents.newGroupWith", { name: a.name }),
        icon: "plus",
        run: () => setGroupDialog({ mode: "create", agentIds: [a.id] }),
      },
    ];
  };
  const agentRow = (a: Agent) => {
    const dm = dmOf.get(a.id);
    const unread = dm?.unread ?? 0;
    return (
      <ErrorBoundary
        key={a.id}
        resetKey={a}
        // Still a row the drag counts (`useAgentDrag`), so a drop below it lands where the pointer is.
        fallback={() => (
          <div className="sidebar__row" data-agent-row={a.id}>
            <UnshownRow />
          </div>
        )}
      >
        <AgentRow
          agent={a}
          unread={unread}
          waitingFor={waitingFor.get(a.id)}
          live={busy.has(a.id) || waits.has(a.id) || waitingFor.has(a.id) || unread > 0}
          pinned={pins.agents.includes(a.id)}
          onPrefetch={() => dm && prefetch(dm.channelId)}
          onOpen={() => markOpen(dm?.channelId ?? a.id)}
          drag={organize ? drag.row(a.id) : undefined}
          menuExtra={[...hideEntry(a), ...(manages ? groupEntries(a) : [])]}
        />
      </ErrorBoundary>
    );
  };
  // Only the middle scrolls: the workspace card on top and the foot stay put. The active item
  // paints its own background (no sliding pill).
  const navRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The list fades out at an edge only while there is more to scroll past it (no hard cut); re-checked as lists load.
  useScrollEdges(navRef, [channels.data, directs.length, shownAgents.length, groups.length, rail]);

  // A tablet's open sidebar folds back on a new page, a width change, Esc (before the page sees it: Esc in a channel
  // would stop an agent; an open menu closes first), a press outside it and focus leaving it (Tab past its end would
  // land on the page under it).
  const sideRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page or width closes it
  useEffect(() => closeTabletSidebar(), [pathname, tablet]);
  useEffect(() => {
    if (!float) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(OPEN_LAYER)) return;
      e.preventDefault();
      // Focus on a row the rail hides would be lost: back to the toggle (the title bar's, in the Mac app).
      if (sideRef.current?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus();
      }
      closeTabletSidebar();
    };
    // Not the title bar's toggle: its click closes it after the press.
    const onOutside = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || sideRef.current?.contains(t) || t.closest("[data-sidebar-toggle]")) return;
      if (!document.querySelector(OPEN_LAYER)) closeTabletSidebar();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("focusin", onOutside, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside, true);
    };
  }, [float]);

  // The open conversation stays in sight: once per navigation (as soon as its row exists), a row
  // hidden past the list's edge is brought to the middle. Later scrolling is the person's. A pinned agent's face
  // counts too: the pinned row leads the list and scrolls away with it.
  const shownFor = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry when the lists load
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>(':is(.sidebar__item, .sidebar__hero-link)[data-status="active"]');
    if (!nav || !active || shownFor.current === pathname) return;
    shownFor.current = pathname;
    const n = nav.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.top < n.top || a.bottom > n.bottom) nav.scrollTop += a.top - n.top - (nav.clientHeight - a.height) / 2;
  }, [pathname, channels.data, directs.length, shownAgents.length, rail]);

  // The person's order of the sections (SidebarOrder.tsx); a section with nothing to show leaves no line.
  const sectionOrder = useSectionOrder(orgId, personal);
  const sectionMenu = (id: SectionKey) =>
    entityMenu(() => [{ kind: "header", label: sectionName(t, id, personal) }, ...sectionOrder.entries(id)]);
  // What the headers' + and the sidebar's own menu (right click on its empty space) create, each as far as the role allows.
  const item = (id: string, label: string, icon: IconName, run: () => void): MenuEntry => ({
    kind: "item",
    id,
    label,
    icon,
    run,
  });
  const newChannelItem = can(org, "create_channels")
    ? [item("new-channel", t(modeKey(org, "shell.sidebarMenu.newChannel")), "channel", () => setCreatingChannel(true))]
    : [];
  const newCategoryItem = can(org, "manage_channels")
    ? [item("new-category", t("channelCategories.newCategory"), "layers", () => setNewCategory({}))]
    : [];
  const archivedItem =
    archivedChannels.length > 0
      ? [item("archived-channels", t("channel.archivedTitle"), "archive", () => setShowArchived(true))]
      : [];
  const createAgentItem = makesAgents(org) ? [item("create-agent", t("shell.createAgent"), "plus", newAgent)] : [];
  const newGroupItem = manages
    ? [item("new-group", t("agentGroups.newGroup"), "layers", () => setGroupDialog({ mode: "create" }))]
    : [];
  const groupsClosed = groupIds.every((id) => !sections.isOpen(id, groupsOpen));
  // The channels the sidebar lists. A personal workspace (ADR 0159) leaves out #general while no one else is in it
  // (unless it is open or something new waits there). With none to list, its group conversations show only for who
  // may create one: the section then holds a "New group conversation" row, the way to the first.
  const quietGeneral = (c: Channel) =>
    c.name === "general" && !looksUnread(c) && !c.mentionCount && !pathname.endsWith(`/c/${c.id}`);
  const listedChannels = (channels.data ?? []).filter(
    (c) => !dmChannels.has(c.id) && !(personal && alone && quietGeneral(c)),
  );
  const channelsShown = !personal || listedChannels.length > 0 || newChannelItem.length > 0;
  // A tool's link keeps the browser's menu, from the mouse and the keyboard alike.
  const spaceEvent = (e: { target: EventTarget }) => !(e.target instanceof Element && e.target.closest("a[href]"));
  const sidebarMenu = entityMenu(() => [
    { kind: "header", label: t("shell.sidebarMenu.title") },
    item("customize", t("shell.customizeSidebar"), "settings", () => setCustomizing(true)),
    { kind: "separator" },
    ...newChannelItem,
    ...newCategoryItem,
    { kind: "separator" },
    ...createAgentItem,
    ...newGroupItem,
    item("team", t("shell.team"), "agent", () => void navigate({ to: "/org/$orgId/team", params: { orgId } })),
    { kind: "separator" },
    sectionOrder.restore,
  ]);
  // The agents' rows, under the Agentes header in a team's workspace and with none in a personal one (ADR 0159).
  const agentRows = (
    <>
      {/* DougBot: the right hand heads the faces on top, so the list doesn't name it twice. */}
      {rightHand && !hero.includes(rightHand) && (
        <RightHandRow
          agent={rightHand}
          unread={rightHandDm?.unread ?? 0}
          onPrefetch={() => rightHandDm && prefetch(rightHandDm.channelId)}
          onOpen={() => rightHandDm && markOpen(rightHandDm.channelId)}
        />
      )}
      {dir.loading && team.length === 0 && <SidebarSkeleton count={2} avatar label={t("common.loadingList")} />}
      {loose.map(agentRow)}
    </>
  );
  // The tools each person keeps in sight; the rest open beside the sidebar from More. Doug draws them as a dock: a
  // glass bar of icons (after Nordus's footer nav), each named on hover and to a screen reader, Configurações last.
  const whatsapp = useWhatsApp(orgId).data;
  const whatsappShown =
    !!whatsapp?.on && !hiddenTools.includes("whatsapp") && (whatsapp.manage || whatsapp.accounts.length > 0);
  // Revisão (docs/adr/doug-0007-video-review.md), with how many wait: always in sight on a server that has it, since
  // anyone of the team sends their own work from it (docs/adr/doug-0015-team-work-review.md).
  const reviewsQuery = useVideoReviews(orgId);
  const reviews = reviewsQuery.data ?? [];
  const reviewsOn = reviewsQuery.isSuccess;
  const reviewsWaiting = reviews.filter((r) => r.status === "in_review").length;
  const reviewWords = useReviewWords();
  const reviewRow = reviewsOn && !hiddenTools.includes("review") && (
    <Link to="/org/$orgId/review" params={{ orgId }} className="sidebar__item" title={reviewWords.title}>
      <Icon name="video" />
      <span className="sidebar__item-label">{reviewWords.title}</span>
      {reviewsWaiting > 0 && <CountBadge>{reviewsWaiting}</CountBadge>}
    </Link>
  );
  // DougBot's team sidebar (the owner's choice of 2026-11-15): the tools as named rows under Go to…, the ones the
  // team opens all day (Início, Portal, Revisão, Tarefas, Configurações); everything else in the grid beside Go to….
  // Revisão comes right after Portal (what clients approve, then what the team reviews), the rest in the person's order.
  const toolRows = (
    <div className="sidebar__group sidebar__tools sidebar__nav">
      <Link to="/org/$orgId/home" params={{ orgId }} className="sidebar__item">
        <Icon name="home" />
        <span className="sidebar__item-label">{t("shell.home")}</span>
      </Link>
      <ToolList items={listed} row={toolRow} after={reviewRow ? { id: "portal", node: reviewRow } : undefined} />
      {/* A tool opened from the grid shows as a row while its page is open, so the sidebar always marks where I am.
          Proposals are a tab of Esperando você: its row lights up for them. */}
      <div className="sidebar__more-active">{inMore.filter((id) => id !== "proposals").map(toolRow)}</div>
      <Link to="/org/$orgId/settings" params={{ orgId }} className="sidebar__item sidebar__nav-settings">
        <Icon name="settings" />
        <span className="sidebar__item-label">{t("shell.settings")}</span>
      </Link>
    </div>
  );
  const launcherTools: LauncherTool[] = [
    ...toolOrder.map((id) => ({
      key: id,
      to: SIDEBAR_TOOLS[id].to,
      label: t(`shell.${id}`),
      hint: t(`shell.moreWhat.${id}`),
      icon: <Icon name={SIDEBAR_TOOLS[id].icon} />,
      count: counts[id] ?? 0,
    })),
    ...(whatsappShown
      ? [{ key: "whatsapp", to: "/org/$orgId/whatsapp", label: "WhatsApp", icon: <WhatsAppMark size={18} /> }]
      : []),
    ...(reviewsOn && !hiddenTools.includes("review")
      ? [
          {
            key: "review",
            to: "/org/$orgId/review",
            label: reviewWords.title,
            icon: <Icon name="video" />,
            count: reviewsWaiting,
          },
        ]
      : []),
  ];
  const launcherCreate = [
    ...newChannelItem,
    ...createAgentItem,
    item("new-message", t("shell.sidebarMenu.newMessage"), "plus", openPalette),
    ...newGroupItem,
  ];
  const dock = (
    <div className="sidebar__group sidebar__tools sidebar__dock">
      <Link to="/org/$orgId/home" params={{ orgId }} className="sidebar__item" title={railTip("home")}>
        <Icon name="home" />
        <span className="sidebar__item-label">{t("shell.home")}</span>
      </Link>
      <ToolList items={listed} row={toolRow} />
      {/* WhatsApp, this instance's own: in sight for anyone with a number, and for who may connect the first one. */}
      {whatsappShown && (
        <Link to="/org/$orgId/whatsapp" params={{ orgId }} className="sidebar__item" title="WhatsApp">
          <WhatsAppMark size={18} />
          <span className="sidebar__item-label">WhatsApp</span>
        </Link>
      )}
      {reviewRow}
      <MoreTools items={inMore} row={toolRow} countOf={countOf} onCustomize={() => setCustomizing(true)} />
      <Link
        to="/org/$orgId/settings"
        params={{ orgId }}
        className="sidebar__item sidebar__dock-settings"
        title={t("shell.settings")}
      >
        <Icon name="settings" />
        <span className="sidebar__item-label">{t("shell.settings")}</span>
      </Link>
    </div>
  );
  const blocks: Record<SectionKey, ReactNode> = {
    // A personal workspace's list is its conversations (ADR 0159): a tool comes into sight only while something
    // waits in it, or once the person put it there; Início, Go to… and the other tools are in More at the end.
    tools: personal
      ? listed.length > 0 && (
          <div className="sidebar__group sidebar__tools">
            <ToolList items={listed} row={toolRow} />
          </div>
        )
      : // The full sidebar keeps its dock fixed at the foot (below); the rail keeps it in its list.
        rail && dock,
    channels: channelsShown && (
      <SidebarChannels
        channels={listedChannels}
        loading={channels.isLoading}
        sections={sections}
        onNewChannel={(categoryId) => setCreatingChannel(categoryId ?? true)}
        onNewCategory={(withChannel) => setNewCategory(withChannel ? { withChannel } : {})}
        onPrefetch={prefetch}
        headProps={sectionMenu("channels")}
        addEntries={[...newChannelItem, ...newCategoryItem, ...archivedItem]}
        pinned={pins.channels}
      />
    ),
    agents: (dir.loading ||
      rightHand ||
      (team.length > 0 ? shownAgents.length > 0 || manages : createAgentItem.length > 0)) && (
      <>
        {personal ? (
          // No header in a personal workspace (ADR 0159): its agents are the list, its right hand first.
          <div className="sidebar__group sidebar__agents-plain">{agentRows}</div>
        ) : (
          <SidebarSection
            id="agents"
            label={t("shell.agents")}
            sections={sections}
            className="sidebar__section--part"
            headProps={sectionMenu("agents")}
            // Who works, workspace-wide, at a glance (ADR 0084 addendum); closed, the part hides its groups too: their
            // unread count with its own.
            status={
              workingAgents > 0 && (
                <span className="sidebar__section-working">{t("sidebarAgents.working", { count: workingAgents })}</span>
              )
            }
            summary={agentsUnread > 0 && <UnreadCount count={agentsUnread} />}
            action={
              <>
                <Menu
                  align="end"
                  label={t("sidebarAgents.options")}
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="more"
                      className="sidebar__section-add"
                      aria-label={t("sidebarAgents.options")}
                      title={t("sidebarAgents.options")}
                    />
                  }
                >
                  <MenuRadioGroup
                    label={t("sidebarAgents.order")}
                    value={view.agentSort}
                    onValueChange={(v) => setView((now) => ({ ...now, agentSort: v as AgentSort }))}
                    options={AGENT_SORTS.map((value) => ({ value, label: t(`sidebarAgents.sort.${value}`) }))}
                  />
                  {manages && (
                    <>
                      <MenuSeparator />
                      <MenuCheckboxItem
                        checked={view.showAllAgents}
                        onCheckedChange={(on) => setView((now) => ({ ...now, showAllAgents: on }))}
                      >
                        {t("sidebarAgents.showAll")}
                      </MenuCheckboxItem>
                    </>
                  )}
                  {hiddenCount > 0 && (
                    <>
                      <MenuSeparator />
                      <MenuCheckboxItem checked={showHidden} onCheckedChange={setShowHidden}>
                        {t("sidebarAgents.showHidden", { count: hiddenCount })}
                      </MenuCheckboxItem>
                    </>
                  )}
                  {(agentGroups.length > 0 || manages) && <MenuSeparator />}
                  {agentGroups.length > 0 && (
                    <MenuItem
                      icon={groupsClosed ? "chevronDown" : "chevronUp"}
                      onSelect={() => sections.setAll(groupIds, groupsClosed)}
                    >
                      {groupsClosed ? t("sidebarAgents.expandAll") : t("sidebarAgents.collapseAll")}
                    </MenuItem>
                  )}
                  {manages && (
                    <MenuItem
                      icon="layers"
                      onSelect={() =>
                        void navigate({ to: "/org/$orgId/team", params: { orgId }, search: { view: "sectors" } })
                      }
                    >
                      {t("sidebarAgents.organize")}
                    </MenuItem>
                  )}
                </Menu>
                <SectionAdd label={t("sidebarAgents.add")} entries={[...createAgentItem, ...newGroupItem]} />
              </>
            }
            drop={organize ? drag.zone(null) : undefined}
          >
            {agentRows}
          </SidebarSection>
        )}
        {agentGroups.map(({ group, items }) => {
          const list = ordered(items);
          // Where a dragged row would land: a line before the row at that place among the others.
          const others = list.filter((a) => a.id !== drag.dragging);
          const lineAt = drag.over?.groupId === group.id ? drag.over.index : null;
          const line = <span className="sidebar__drop-line" aria-hidden="true" />;
          const workingHere = list.filter((a) => busy.has(a.id)).length;
          return (
            <SidebarSection
              key={group.id}
              id={`group:${group.id}`}
              label={group.name}
              mark={<RoleMark color={group.color ?? "graphite"} icon={group.icon ?? "person"} size={16} />}
              sections={sections}
              defaultOpen={groupsOpen}
              className="sidebar__section--category sidebar__section--group"
              headProps={
                manages
                  ? entityMenu(() => [{ kind: "header", label: group.name }, ...groupMenuEntries(groupChoices(group))])
                  : undefined
              }
              summary={
                workingHere > 0 && (
                  <span className="sidebar__section-working">{t("sidebarAgents.working", { count: workingHere })}</span>
                )
              }
              action={
                <>
                  {manages && <GroupMenu {...groupChoices(group)} className="sidebar__section-add" />}
                  <span className="sidebar__section-count" title={t("sidebarAgents.count", { count: list.length })}>
                    {list.length}
                  </span>
                </>
              }
              drop={organize ? drag.zone(group.id) : undefined}
            >
              {list.map((a) => (
                <Fragment key={a.id}>
                  {lineAt === others.indexOf(a) && line}
                  {agentRow(a)}
                </Fragment>
              ))}
              {lineAt !== null && lineAt >= others.length && line}
              {manages && group.agentIds.length === 0 && (
                <span className="sidebar__drop-hint">{t("agentGroups.dropHere")}</span>
              )}
            </SidebarSection>
          );
        })}
        {listsAllAgents(org) && team.length > shownAgents.length && (
          <Link to="/org/$orgId/team" params={{ orgId }} className="sidebar__item sidebar__see-all">
            <Icon name="agent" />
            <span className="sidebar__item-label">
              {t("sidebarAgents.more", { count: team.length - shownAgents.length })}
            </span>
          </Link>
        )}
        {/* New agent right under the agents, in a personal workspace (ADR 0159) and a team's (ADR 0164); the rail's
            tile, with no headers there (a team's rail has its own in the foot). */}
        {createAgentItem.length > 0 &&
          (rail ? personal && <CreateAgentTile onOpen={newAgent} /> : <NewAgentRow onOpen={newAgent} />)}
      </>
    ),
    // A personal workspace lists people only once someone else is a member (a family, ADR 0159).
    // The rail has no header or empty line to show: no one to list leaves no section (nor its rule) there.
    people: !(personal && alone) && !(rail && directs.length === 0) && (
      <SidebarSection
        id="people"
        label={t("shell.directMessages")}
        sections={sections}
        className="sidebar__section--part"
        headProps={sectionMenu("people")}
        summary={directsUnread > 0 && <UnreadCount count={directsUnread} />}
        // "Nova mensagem" is Ir para…, which finds anyone (people and agents).
        action={
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="plus"
            className="sidebar__section-add"
            aria-label={t("shell.sidebarMenu.newMessage")}
            title={t("shell.sidebarMenu.newMessage")}
            onClick={openPalette}
          />
        }
      >
        {directs.map(({ dm, member }) => (
          <ErrorBoundary key={dm.channelId} resetKey={member} fallback={unshownRow}>
            <PersonRow
              member={member}
              unread={dm.unread}
              pinned={pins.people.includes(member.userId)}
              onPrefetch={() => prefetch(dm.channelId)}
              onOpen={() => markOpen(dm.channelId)}
            />
          </ErrorBoundary>
        ))}
        {!rail && directs.length === 0 && !dms.isLoading && (
          <p className="sidebar__empty">
            {t("sidebarAgents.dmsEmpty")}{" "}
            <button type="button" className="ac-link" onClick={openPalette}>
              {t("shell.sidebarMenu.newMessage")}
            </button>
          </p>
        )}
      </SidebarSection>
    ),
  };

  // The inbox: at the end of my row in the foot, or beside me on top in a personal workspace.
  const bell = (
    <Link
      to="/org/$orgId/notifications"
      params={{ orgId }}
      className="sidebar__bell"
      title={t("shell.notifications")}
      aria-label={
        unreadNotifications > 0
          ? t("shell.unreadNotifications", { count: unreadNotifications })
          : t("shell.notifications")
      }
    >
      <Icon name="bell" />
      {unreadNotifications > 0 && (
        <CountBadge key={bumps} className={cx("sidebar__unread", bumps > 0 && "sidebar__bump")}>
          {badgeCount(unreadNotifications)}
        </CountBadge>
      )}
    </Link>
  );
  // The sidebar's toggle, in one place at every width: beside ⌘K (beside the bell in a personal workspace), under them
  // in the rail. In a phone's drawer it closes the drawer.
  const collapseLabel = compact ? t("shell.closeNav") : collapsed ? t("shell.expandNav") : t("shell.collapseNav");
  const collapseProps = {
    variant: "ghost",
    iconOnly: true,
    icon: "sidebar",
    "data-sidebar-toggle": "",
    "aria-label": collapseLabel,
    title: collapseLabel,
    "aria-expanded": compact || !collapsed,
    onClick: compact ? () => drawer?.close({ restoreFocus: true }) : toggleCollapsed,
  } as const;
  // DougBot's head opens the workspace's own menu from the person's.
  const headRef = useRef<HTMLDivElement>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const accountActions = useRef<AccountActions | null>(null);
  // The workspace header's line. Each count with its own plural: one summary string followed the people's, so
  // "1 agentes".
  const headCounts = overview.data
    ? [
        t("settings.tileState.members", { count: overview.data.people }),
        t("sidebarAgents.count", { count: overview.data.agents }),
      ]
    : [];
  const summary = headCounts.length > 0 ? headCounts.join(" · ") : null;

  const heroRow =
    hero.length > 0 ? (
      <PinnedHero
        agents={hero}
        unreadOf={(id) => dmOf.get(id)?.unread ?? 0}
        onPrefetch={(id) => {
          const dm = dmOf.get(id);
          if (dm) prefetch(dm.channelId);
        }}
        onOpen={(id) => markOpen(dmOf.get(id)?.channelId ?? id)}
        drag={organize ? (id) => (id === rightHand?.id ? undefined : drag.row(id)) : undefined}
        menuExtra={(a) => (isRightHand(a) ? [] : [...hideEntry(a), ...(manages ? groupEntries(a) : [])])}
      />
    ) : null;

  return (
    <nav
      className="sidebar"
      aria-label={t("shell.nav")}
      data-rail={rail}
      data-float={float || undefined}
      ref={sideRef}
      // Its faces' sizes follow the mode (the agents' and New agent's, ADR 0164).
      data-personal={personal || undefined}
      {...drawer?.navProps}
    >
      <div className="sidebar__top">
        <WorkspaceSky part="side" rail={rail} />
        {/* The signature on top (IDENTIDADE.md §3): the Doug close up and the name, no box. */}
        {!rail &&
          (personal ? (
            <Logo className="sidebar__assina" size={18} />
          ) : (
            // DougBot: the signature, then the bell and the collapse as loose icons on its line, so the person's block
            // and Go to… below have the whole width.
            <div className="sidebar__brand-row">
              <Logo className="sidebar__assina" size={18} />
              <span className="sidebar__brand-acts">
                <AgoraButton below={compact} className="sidebar__agora" />
                {bell}
                <Button {...collapseProps} className="sidebar__collapse" />
              </span>
            </div>
          ))}
        {personal ? (
          // A personal workspace (ADR 0159): the person on top (their account, settings and workspaces in one menu),
          // Agora, the bell and the collapse beside them. The desktop app's title bar has its own Agora and collapse
          // (desktop.css).
          <div className="sidebar__org sidebar__org--person">
            <AccountMenu personal />
            <AgoraButton below={compact} className="sidebar__agora" />
            {bell}
            <Button {...collapseProps} size="sm" className="sidebar__head-collapse" />
          </div>
        ) : (
          <>
            {/* DougBot: the person on top (their face, name, the workspace under it, the bell beside), one menu for the
                workspaces and the account; no card at the foot repeating it. The rail has nothing on top: its list
                starts there and the person, the bell, Go to… and the toggle are one card at its foot. */}
            {!rail && (
              <div className="sidebar__head-row">
                <div className="sidebar__org sidebar__org--person sidebar__org--head" ref={headRef}>
                  <AccountMenu
                    head
                    sub={[org.name, headCounts[1] ?? null]}
                    onWorkspace={() => setWorkspaceOpen(true)}
                    actions={accountActions}
                  />
                  <WorkspaceMenu
                    summary={summary}
                    control={{ open: workspaceOpen, onOpenChange: setWorkspaceOpen, anchor: headRef }}
                    you={accountActions}
                  />
                </div>
              </div>
            )}

            {!rail && (
              <div className="sidebar__jump-row">
                <button type="button" className="sidebar__jump" onClick={openPalette} title={t("palette.jump")}>
                  <Icon name="search" />
                  <span className="sidebar__item-label">{t("palette.jump")}</span>
                  <Kbd>{modKey()}</Kbd>
                  <Kbd>K</Kbd>
                </button>
                <ToolLauncher tools={launcherTools} create={launcherCreate} onCustomize={() => setCustomizing(true)} />
              </div>
            )}
            {!rail && toolRows}
          </>
        )}
      </div>

      {/* Space, not lines, between the tools, the channels, the agents and the people. A right click on the space
          between the rows (not on a row or a header, which have their own) opens the sidebar's menu; a link with no
          menu of its own (a tool) keeps the browser's. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right click and Shift+F10 of the sidebar's own menu */}
      <div
        className="sidebar__scroll"
        ref={navRef}
        onKeyDown={(e) => spaceEvent(e) && sidebarMenu.onKeyDown(e)}
        onContextMenu={(e) => spaceEvent(e) && sidebarMenu.onContextMenu(e)}
      >
        {/* DougBot: the pinned faces lead the list and scroll away with it (like a chat app's pinned chats), so the
            list below gets the room. */}
        {heroRow}
        {sectionOrder.order.filter((id) => blocks[id]).map((id) => sectionOrder.block(id, blocks[id], !rail))}
      </div>

      {/* A personal workspace's end (ADR 0159): one More, holding Início, Go to… and every tool not in sight. */}
      {personal && (
        <div className="sidebar__end">
          <MoreTools items={inMore} row={toolRow} countOf={countOf} onCustomize={() => setCustomizing(true)} home />
        </div>
      )}

      <ArchivedChannelsDialog open={showArchived} onClose={() => setShowArchived(false)} />
      <NewChannelDialog
        open={creatingChannel !== false}
        onOpenChange={(open) => setCreatingChannel(open)}
        category={typeof creatingChannel === "string" ? creatingChannel : null}
      />
      <NewCategoryDialog
        open={newCategory !== null}
        onOpenChange={(open) => !open && setNewCategory(null)}
        withChannel={newCategory?.withChannel}
      />
      <SidebarSetupDialog open={customizing} onClose={() => setCustomizing(false)} />
      {groupDialog && <GroupNameDialog purpose={groupDialog} onClose={() => setGroupDialog(null)} />}
      {deletingGroup && <DeleteGroupDialog group={deletingGroup} onClose={() => setDeletingGroup(null)} />}

      {/* DougBot: no feedback row at the bottom (it went to agentes.chat's team); the list keeps the room. */}
      {/* No foot in a personal workspace (ADR 0159): the person, the bell and the collapse are on top. */}
      {!personal && (
        <div className="sidebar__foot">
          {/* How many agents work now, as a quiet line over the account card (no sky rising from the foot). */}
          {working > 0 && !rail && (
            <span className="sidebar__working" role="status">
              <span className="sidebar__working-dot" aria-hidden="true" />
              {t("sidebarAgents.working", { count: working })}
            </span>
          )}
          {/* The full sidebar creates from the Agentes header's + (always shown on touch screens); the rail has no
              headers. */}
          {rail && createAgentItem.length > 0 && <CreateAgentTile onOpen={newAgent} />}
          {/* The rail's one card at its foot, read from the bottom up: me (my account's menu, which also opens the
              workspace's full-screen one: the rail has no workspace mark on top), the bell, Go to… and the toggle. */}
          {rail && (
            <div className="sidebar__me sidebar__me--rail" ref={headRef}>
              <AgoraButton below={compact} className="sidebar__agora" />
              <Button {...collapseProps} className="sidebar__collapse" />
              <Button
                variant="ghost"
                iconOnly
                icon="search"
                className="sidebar__rail-jump"
                aria-label={t("palette.jump")}
                title={t("palette.jump")}
                onClick={openPalette}
              />
              {bell}
              <AccountMenu onWorkspace={() => setWorkspaceOpen(true)} actions={accountActions} />
              <WorkspaceMenu
                summary={summary}
                control={{ open: workspaceOpen, onOpenChange: setWorkspaceOpen, anchor: headRef }}
                you={accountActions}
              />
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

/** Create agent as one of the rail's tiles (the full sidebar creates from the Agents header's +). */
/**
 * New agent under the agents (ADR 0159, ADR 0164): a row like theirs, an empty face with a plus where a face would be,
 * so it reads as the next one.
 */
function NewAgentRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="sidebar__item sidebar__new-agent" onClick={onOpen}>
      <span className="sidebar__new-agent-face" aria-hidden="true">
        <Icon name="plus" size={16} />
      </span>
      <span className="sidebar__item-label">{t("sidebarAgents.newAgent")}</span>
    </button>
  );
}

function CreateAgentTile({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Button block variant="ghost" className="sidebar__create" title={t("shell.createAgent")} onClick={onOpen}>
      <Icon name="plus" />
      <span className="sidebar__item-label">{t("shell.createAgent")}</span>
    </Button>
  );
}

/** The fixed sections, a channel category as `category:<id>` (ADR 0080) and a group of agents as `group:<id>` (ADR 0083). */
type SectionId = "channels" | "agents" | "people" | `category:${string}` | `group:${string}`;

/**
 * Which sidebar categories are closed, remembered in this browser for each person in each workspace. One closed by
 * default (`byDefault` false) and opened by the person is kept as `+<id>`.
 */
function useSidebarSections(userId: string, orgId: string) {
  const key = `${STORAGE_KEYS.sidebarSections}.${userId}.${orgId}`;
  const [saved, setSaved] = useState(() => ({ key, closed: new Set(storedStrings(key)) }));
  // The sidebar stays mounted when the workspace changes: that one's own state.
  if (saved.key !== key) setSaved({ key, closed: new Set(storedStrings(key)) });
  const change = (edit: (closed: Set<string>) => void) =>
    setSaved((prev) => {
      const closed = new Set(prev.closed);
      edit(closed);
      storage.set(prev.key, JSON.stringify([...closed]));
      return { key: prev.key, closed };
    });
  const openIn = (closed: Set<string>, id: SectionId, byDefault: boolean) =>
    closed.has(id) ? false : closed.has(`+${id}`) || byDefault;
  const toggle = (id: SectionId, byDefault = true) =>
    change((closed) => {
      const open = openIn(closed, id, byDefault);
      closed.delete(id);
      closed.delete(`+${id}`);
      if (open) closed.add(id);
      else if (!byDefault) closed.add(`+${id}`);
    });
  /** "Fechar todas" / "Abrir todas" for the channel categories and the groups of agents. */
  const setAll = (ids: SectionId[], open: boolean) =>
    change((closed) => {
      for (const id of ids) {
        closed.delete(id);
        closed.delete(`+${id}`);
        closed.add(open ? `+${id}` : id);
      }
    });
  return { isOpen: (id: SectionId, byDefault = true) => openIn(saved.closed, id, byDefault), toggle, setAll };
}

/**
 * A sidebar category that opens and closes. Closed, it keeps its open page's row in sight (CSS shows
 * only the active item), and shows `summary` (a count) on its header.
 * On the icon rail the header goes away and every item shows. `drop`: it takes dragged channels or agents.
 */
function SidebarSection({
  id,
  label,
  sections,
  defaultOpen = true,
  summary,
  status,
  action,
  drop,
  className,
  headProps,
  mark,
  children,
}: {
  id: SectionId;
  label: string;
  /** Before the label: a setor's color and icon. */
  mark?: ReactNode;
  sections: ReturnType<typeof useSidebarSections>;
  /** Open until the person closes it (a long team's groups start closed). */
  defaultOpen?: boolean;
  summary?: ReactNode;
  /** Open or closed, at the head's end: how many of its agents work ("1 trabalhando"). */
  status?: ReactNode;
  action?: ReactNode;
  /** It takes a drop: dragged agents (`useAgentDrag`), or channels taken out of their category. */
  drop?: HTMLAttributes<HTMLDivElement> & { "data-drop"?: string | boolean };
  className?: string;
  /** A channel category's header: its right click and dragging. */
  headProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}) {
  const open = sections.isOpen(id, defaultOpen);
  const bodyId = `sidebar-section-${id.replace(":", "-")}`;
  return (
    <div className={cx("sidebar__group sidebar__section", className)} data-open={open} {...drop}>
      <div className="sidebar__section-head" {...headProps}>
        <button
          type="button"
          className="sidebar__section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => sections.toggle(id, defaultOpen)}
        >
          <Icon name="chevronDown" size={14} className="sidebar__section-chevron" />
          {mark}
          <span className="sidebar__label">{label}</span>
        </button>
        {status}
        {!open && summary}
        {action}
      </div>
      <div id={bodyId} className="sidebar__section-body">
        {children}
      </div>
    </div>
  );
}

/** A part header's +: a menu of what it creates (none of it allowed: no +). */
function SectionAdd({ label, entries }: { label: string; entries: MenuEntry[] }) {
  if (!entries.length) return null;
  return (
    <Menu
      align="end"
      label={label}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="plus"
          className="sidebar__section-add"
          aria-label={label}
          title={label}
        />
      }
    >
      <MenuEntries entries={entries} />
    </Menu>
  );
}

/** A button over a row's end on hover or focus (`.sidebar__row-acts`), in place of its count or role. */
function RowAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={icon}
      className="sidebar__row-menu"
      aria-label={label}
      title={label}
      onClick={onClick}
    />
  );
}

/** Where a dragged channel or category would land: the row or header it is over, and how. */
type DropMark = { key: string; where: "before" | "after" | "into" } | null;
type Dragging = { kind: "channel" | "category"; id: string };
/** One thing a category's ⋯ (and its right click) can do. */
interface CategoryAction {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
  danger?: boolean;
  description?: string;
}
const CATEGORY_KEY = "category:";

/**
 * The channels (ADR 0080): the "Canais" part, its channels with no category first, then one section per category
 * (closed, "Canais" hides them too, but the open channel's); closed, a category keeps the open channel and the unread
 * ones in sight (CSS). Who may manage channels arranges the categories; they and a channel's creator move it by
 * dragging, from its right click ("Mover para…") or in its details.
 */
function SidebarChannels({
  channels: all,
  loading,
  sections,
  onNewChannel,
  onNewCategory,
  onPrefetch,
  headProps,
  addEntries,
  pinned,
}: {
  channels: Channel[];
  loading: boolean;
  sections: ReturnType<typeof useSidebarSections>;
  /** A category's + (its id), or a new channel with none (null). */
  onNewChannel: (categoryId: string | null) => void;
  /** A new category, with the channel whose menu asked for it. */
  onNewCategory: (withChannel?: string) => void;
  onPrefetch: (channelId: string) => void;
  /** "Canais"' header: the section's own menu (its place in the sidebar). */
  headProps?: HTMLAttributes<HTMLDivElement>;
  /** What "Canais"' + creates. */
  addEntries: MenuEntry[];
  /** The channels pinned on top of "Canais" ("Fixar no topo"), in order. */
  pinned: readonly string[];
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const orgId = org.id;
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useChannelCategories(orgId);
  const place = usePlaceChannel(orgId);
  const placeCategory = usePlaceChannelCategory(orgId);
  const removeCategory = useDeleteChannelCategory(orgId);
  const recreate = useCreateChannelCategory(orgId);
  const manages = can(org, "manage_channels");
  // An administrator reads every channel (ADR 0151): the ones they aren't in wait under one row, not in the list.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const channels = all.filter((c) => !c.seenAsAdmin || path.endsWith(`/c/${c.id}`));
  const others = all.filter((c) => !channels.includes(c));
  const mayCreate = can(org, "create_channels");
  const mayChange = (c: Channel) => managesChannel(c, me.user.id, org);
  const [renaming, setRenaming] = useState<ChannelCategory | null>(null);
  const [moving, setMoving] = useState<Channel | null>(null);
  const drag = useRef<Dragging | null>(null);
  const [mark, setMark] = useState<DropMark>(null);
  const failed = (e: unknown) => toast.show(errorText(t, e), "error");

  const list = categories.data ?? [];
  const known = new Set(list.map((c) => c.id));
  // A channel whose category isn't loaded yet (or is gone) shows with the ones with none. So nothing drags until
  // the categories load: a drop would take the channel out of its category.
  const categoryOf = (c: Channel) => (c.categoryId && known.has(c.categoryId) ? c.categoryId : null);
  const pinnedChannels = pinned.flatMap((id) => channels.filter((c) => c.id === id && c.isMember));
  const unpinned = channels.filter((c) => !pinnedChannels.includes(c));
  const loose = unpinned.filter((c) => categoryOf(c) === null);
  const inCategory = (id: string) => unpinned.filter((c) => categoryOf(c) === id);
  // A category shows while it holds a channel I can see; who manages channels keeps the empty ones to drop channels in.
  const shown = manages ? list : list.filter((c) => inCategory(c.id).length > 0);
  const categoryIds = shown.map((c) => `${CATEGORY_KEY}${c.id}` as SectionId);

  // ── Dragging: a channel onto a channel (before/after) or a header (into); a header onto a header ──
  const endDrag = () => {
    drag.current = null;
    setMark(null);
  };
  const startDrag = (e: DragEvent, what: Dragging) => {
    drag.current = what;
    e.dataTransfer.effectAllowed = "move";
    // Firefox starts a drag only with some data set. Not text, or a text field it's dropped on types the id.
    e.dataTransfer.setData(`application/x-agentes-${what.kind}`, what.id);
  };
  const half = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? "after" : "before";
  };
  const over = (e: DragEvent, key: string, where: "before" | "after" | "into") => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (mark?.key !== key || mark.where !== where) setMark({ key, where });
  };
  const overChannel = (e: DragEvent, c: Channel) => {
    const d = drag.current;
    if (d?.kind !== "channel") return;
    if (d.id !== c.id) return over(e, `channel:${c.id}`, half(e));
    // Over its own row it lands nowhere: not at the end of the section around it.
    e.stopPropagation();
    if (mark) setMark(null);
  };
  // "Into" the part the channel is already in lands nowhere: the server would move it to that part's end.
  const intoPart = (e: DragEvent, key: string) => {
    const d = drag.current;
    if (d?.kind !== "channel") return;
    const dragged = channels.find((c) => c.id === d.id);
    const home = dragged && categoryOf(dragged);
    if (home === undefined || key !== (home === null ? "loose" : `${CATEGORY_KEY}${home}`)) return over(e, key, "into");
    e.stopPropagation();
    if (mark) setMark(null);
  };
  const overCategory = (e: DragEvent, category: ChannelCategory) => {
    const d = drag.current;
    if (d?.kind === "channel") intoPart(e, `${CATEGORY_KEY}${category.id}`);
    else if (d?.kind === "category" && d.id !== category.id) over(e, `${CATEGORY_KEY}${category.id}`, half(e));
  };
  const overLoose = (e: DragEvent) => intoPart(e, "loose");
  // Anywhere in a category but on a row (its empty end, a row's hover buttons): a channel goes in, at its end.
  const overCategoryBody = (e: DragEvent, category: ChannelCategory) => intoPart(e, `${CATEGORY_KEY}${category.id}`);
  const drop = (e: DragEvent) => {
    const d = drag.current;
    const m = mark;
    endDrag();
    if (!d || !m) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.kind === "category") {
      const target = m.key.slice(CATEGORY_KEY.length);
      const i = list.findIndex((c) => c.id === target);
      const before = m.where === "before" ? target : (list[i + 1]?.id ?? null);
      if (before !== d.id) placeCategory.mutate({ categoryId: d.id, beforeCategoryId: before }, { onError: failed });
      return;
    }
    if (m.key === "loose") return place.mutate({ channelId: d.id, categoryId: null }, { onError: failed });
    if (m.key.startsWith(CATEGORY_KEY)) {
      const categoryId = m.key.slice(CATEGORY_KEY.length);
      if (!sections.isOpen(`${CATEGORY_KEY}${categoryId}` as SectionId))
        sections.toggle(`${CATEGORY_KEY}${categoryId}` as SectionId);
      return place.mutate({ channelId: d.id, categoryId }, { onError: failed });
    }
    const target = channels.find((c) => `channel:${c.id}` === m.key);
    if (!target) return;
    const categoryId = categoryOf(target);
    const siblings = categoryId ? inCategory(categoryId) : loose;
    const i = siblings.findIndex((c) => c.id === target.id);
    const before = m.where === "before" ? target.id : (siblings[i + 1]?.id ?? null);
    const from = siblings.findIndex((c) => c.id === d.id);
    // Already there. The server would still renumber the group, and a group arranged by hand takes new
    // channels at its end instead of by name (endOfCategory).
    if (before === d.id || (from >= 0 && (siblings[from + 1]?.id ?? null) === before)) return;
    place.mutate({ channelId: d.id, categoryId, beforeChannelId: before }, { onError: failed });
  };
  const dropMark = (key: string) => (mark?.key === key ? mark.where : undefined);

  // ── Menus: a channel's and a category's right click (lib/entity-menu.ts), and a category's ⋯ ──
  const channelEntries = useChannelMenu();
  const channelMenu = (c: Channel) =>
    entityMenu(() =>
      channelEntries(c, [
        ...(mayChange(c) && list.length > 0
          ? ([
              {
                kind: "item",
                id: "move",
                label: t("channelCategories.move"),
                icon: "move",
                run: () => setMoving(c),
              },
            ] satisfies MenuEntry[])
          : []),
        ...(manages
          ? ([
              {
                kind: "item",
                id: "new-category",
                label: t("channelCategories.newWithChannel"),
                icon: "layers",
                run: () => onNewCategory(c.id),
              },
            ] satisfies MenuEntry[])
          : []),
      ]),
    );
  const deleteCategory = (category: ChannelCategory) => {
    const taken = inCategory(category.id).map((c) => c.id);
    const next = list[list.findIndex((c) => c.id === category.id) + 1]?.id ?? null;
    removeCategory.mutate(category.id, {
      onError: failed,
      onSuccess: () =>
        toast.show(
          taken.length
            ? t("channelCategories.deleted", { name: category.name, count: taken.length })
            : t("channelCategories.deletedEmpty", { name: category.name }),
          "info",
          {
            label: t("channelCategories.undo"),
            // Undo: the same name and channels, back in its place.
            run: () =>
              recreate.mutate(
                { name: category.name, channelIds: taken },
                {
                  onError: failed,
                  onSuccess: (again) => {
                    if (next) placeCategory.mutate({ categoryId: again.id, beforeCategoryId: next });
                  },
                },
              ),
          },
        ),
    });
  };
  const allClosed = categoryIds.every((id) => !sections.isOpen(id));
  const categoryActions = (category: ChannelCategory) => {
    const actions: CategoryAction[] = [];
    if (mayCreate)
      actions.push({
        id: "new-channel",
        label: t("channelCategories.newChannelHere"),
        icon: "plus",
        run: () => onNewChannel(category.id),
      });
    if (manages)
      actions.push({
        id: "rename",
        label: t("channelCategories.rename"),
        icon: "edit",
        run: () => setRenaming(category),
      });
    actions.push({
      id: "fold",
      label: allClosed ? t("channelCategories.expandAll") : t("channelCategories.collapseAll"),
      icon: "list",
      run: () => sections.setAll(categoryIds, allClosed),
    });
    if (manages)
      actions.push(
        {
          id: "new-category",
          label: t("channelCategories.newCategory"),
          icon: "layers",
          run: () => onNewCategory(),
        },
        {
          id: "delete",
          label: t("channelCategories.delete"),
          description: t("channelCategories.deleteDesc"),
          icon: "trash",
          danger: true,
          run: () => deleteCategory(category),
        },
      );
    return actions;
  };

  // A pinned row stays put: it doesn't drag, and nothing drops on it.
  const row = (c: Channel, top = false) => {
    // Discord's marks: something new lights the row (a pill on its left edge, the name in full ink) with how many
    // messages wait, in a quiet count; only a mention of me gets the red one. Muted, it rests dim whatever comes, but a
    // mention still shows.
    const unread = looksUnread(c);
    const mentions = c.mentionCount ?? 0;
    const link = (
      <Link
        key={c.id}
        to="/org/$orgId/c/$channelId"
        params={{ orgId, channelId: c.id }}
        className="sidebar__item"
        title={c.displayName ? `${channelTitle(c)} · #${c.name}` : `#${c.name}`}
        data-kind="channel"
        data-unread={unread}
        data-muted={c.muted || undefined}
        {...(top
          ? {}
          : {
              "data-drop": dropMark(`channel:${c.id}`),
              draggable: categories.data !== undefined && mayChange(c),
              onDragStart: (e: DragEvent) => startDrag(e, { kind: "channel", id: c.id }),
              onDragEnd: endDrag,
              onDragOver: (e: DragEvent) => overChannel(e, c),
              onDrop: drop,
            })}
        onMouseEnter={() => onPrefetch(c.id)}
        onFocus={() => onPrefetch(c.id)}
        onClick={() => markOpen(c.id)}
        {...channelMenu(c)}
      >
        {c.icon ? (
          // Its photo, like a group's picture, where the "#" goes (and on the rail, where its initials go).
          <ChannelPhoto icon={c.icon} className="sidebar__channel-photo" />
        ) : (
          <>
            <Icon name="channel" className="sidebar__channel-icon" />
            <span className="sidebar__channel-abbr" aria-hidden="true">
              {channelInitials(channelTitle(c))}
            </span>
          </>
        )}
        <span className="sidebar__item-label">{channelTitle(c)}</span>
        {mentions > 0 ? (
          <UnreadCount count={mentions} mentions />
        ) : unread ? (
          <UnreadCount count={c.unreadCount ?? 0} quiet />
        ) : (
          top && <PinnedMark />
        )}
      </Link>
    );
    // On hover or focus, like Discord's invite and settings: who manages the channel adds members or opens its details.
    if (!mayChange(c)) return link;
    const open = (ask: "details" | "add") => () => {
      requestChannelDetails(c.id, ask);
      void navigate({ to: "/org/$orgId/c/$channelId", params: { orgId, channelId: c.id } });
    };
    return (
      <div key={c.id} className="sidebar__row" data-unread={unread} data-acts={2}>
        {link}
        <span className="sidebar__row-acts">
          <RowAction icon="personAdd" label={t("shell.sidebarMenu.addMembers")} onClick={open("add")} />
          <RowAction icon="cog" label={t("shell.sidebarMenu.channelSettings")} onClick={open("details")} />
        </span>
      </div>
    );
  };
  const addButton = (categoryId: string | null, label: string) =>
    mayCreate ? (
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="plus"
        className="sidebar__section-add"
        aria-label={label}
        title={label}
        onClick={() => onNewChannel(categoryId)}
      />
    ) : null;
  const dialogs = (
    <>
      <RenameCategoryDialog category={renaming} onOpenChange={(open) => !open && setRenaming(null)} />
      <MoveChannelDialog channel={moving} onOpenChange={(open) => !open && setMoving(null)} canCreate={manages} />
    </>
  );
  const mentions = channels.reduce((n, c) => n + (c.isMember ? (c.mentionCount ?? 0) : 0), 0);

  return (
    <>
      <SidebarSection
        id="channels"
        // A personal workspace's are its group conversations (ADR 0159).
        label={t(modeKey(org, "shell.channels"))}
        sections={sections}
        className="sidebar__section--part"
        headProps={headProps}
        summary={mentions > 0 && <UnreadCount count={mentions} mentions />}
        action={<SectionAdd label={t(modeKey(org, "shell.sidebarMenu.addToChannels"))} entries={addEntries} />}
        // The channels with no category take a channel dragged out of one.
        drop={shown.length > 0 ? { "data-drop": dropMark("loose"), onDragOver: overLoose, onDrop: drop } : undefined}
      >
        {loading && <SidebarSkeleton count={3} label={t("common.loadingList")} />}
        {pinnedChannels.map((c) => row(c, true))}
        {pinnedChannels.length > 0 && (loose.length > 0 || shown.length > 0) && <hr className="sidebar__pins-end" />}
        {loose.map((c) => row(c))}
        {/* A personal workspace with no group conversation yet (ADR 0159): a row to create the first; after it, the
            header's + does. */}
        {isPersonal(org) && mayCreate && !loading && all.length === 0 && (
          <button type="button" className="sidebar__item sidebar__new-channel" onClick={() => onNewChannel(null)}>
            <Icon name="plus" className="sidebar__channel-icon" />
            <span className="sidebar__item-label">{t("shell.sidebarMenu.newChannelPersonal")}</span>
          </button>
        )}
        {others.length > 0 && (
          <Menu
            label={t(modeKey(org, "shell.otherChannels"))}
            trigger={
              <button type="button" className="sidebar__item" data-kind="channel">
                <Icon name="lock" />
                <span className="sidebar__item-label">{t(modeKey(org, "shell.otherChannels"))}</span>
                <CountChip className="sidebar__count">{others.length}</CountChip>
              </button>
            }
          >
            {others.map((c) => (
              <MenuItem
                key={c.id}
                icon="lock"
                onSelect={() => void navigate({ to: "/org/$orgId/c/$channelId", params: { orgId, channelId: c.id } })}
              >
                {channelTitle(c)}
              </MenuItem>
            ))}
          </Menu>
        )}
      </SidebarSection>
      {shown.map((category) => {
        const actions = categoryActions(category);
        return (
          <SidebarSection
            key={category.id}
            id={`${CATEGORY_KEY}${category.id}`}
            label={category.name}
            sections={sections}
            className="sidebar__section--category"
            drop={{ onDragOver: (e) => overCategoryBody(e, category), onDrop: drop }}
            headProps={
              {
                draggable: manages,
                "data-drop": dropMark(`${CATEGORY_KEY}${category.id}`),
                onDragStart: (e) => startDrag(e, { kind: "category", id: category.id }),
                onDragEnd: endDrag,
                onDragOver: (e) => overCategory(e, category),
                onDrop: drop,
                ...entityMenu(() => [
                  { kind: "header", label: category.name },
                  ...actions.map(
                    (a): MenuEntry => ({
                      kind: "item",
                      id: a.id,
                      label: a.label,
                      icon: a.icon,
                      danger: a.danger,
                      run: a.run,
                    }),
                  ),
                ]),
              } as HTMLAttributes<HTMLDivElement>
            }
            action={
              <>
                {addButton(category.id, t("channelCategories.newChannelIn", { name: category.name }))}
                <Menu
                  align="start"
                  label={t("channelCategories.options", { name: category.name })}
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="more"
                      className="sidebar__section-add"
                      aria-label={t("channelCategories.options", { name: category.name })}
                    />
                  }
                >
                  {actions.map((a) => (
                    <Fragment key={a.id}>
                      {a.id === "new-category" && <MenuSeparator />}
                      <MenuItem icon={a.icon} danger={a.danger} description={a.description} onSelect={a.run}>
                        {a.label}
                      </MenuItem>
                    </Fragment>
                  ))}
                </Menu>
              </>
            }
          >
            {inCategory(category.id).map((c) => row(c))}
          </SidebarSection>
        );
      })}
      {dialogs}
    </>
  );
}

/** The tools whose line in More has a personal workspace's words (ADR 0159); the others' fit both. */
type PersonalWhat = Exclude<SidebarItem, "routines" | "drive" | "waiting" | "portal">;
const hasPersonalWhat = (id: SidebarItem): id is PersonalWhat =>
  id !== "routines" && id !== "drive" && id !== "waiting" && id !== "portal";

/**
 * More: the tools the person keeps out of the list, in a panel beside the sidebar (so nothing below moves), each with a
 * line on what it is for, then "Personalizar a barra lateral". The one opened from it stays in sight under it (CSS
 * shows only the active row).
 */
function MoreTools({
  items,
  row,
  countOf,
  onCustomize,
  home = false,
}: {
  items: SidebarItem[];
  row: (id: SidebarItem) => ReactNode;
  countOf: (id: SidebarItem) => ReactNode;
  onCustomize: () => void;
  /** At a personal workspace's end (ADR 0159): Início and Go to… open its list, and it opens upward. */
  home?: boolean;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const personal = isPersonal(org);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={t("shell.more")}
        side="right"
        align={home ? "end" : "start"}
        className="sidebar__more-menu"
        trigger={
          <button ref={trigger} type="button" className="sidebar__item sidebar__more" title={t("shell.more")}>
            <Icon name="more" />
            <span className="sidebar__item-label">{t("shell.more")}</span>
            <Icon name="chevronRight" size={16} className="sidebar__more-chevron" />
          </button>
        }
      >
        {home && (
          <>
            <Link
              to="/org/$orgId/home"
              params={{ orgId: org.id }}
              className="ac-menu__item sidebar__more-item"
              onClick={() => setOpen(false)}
            >
              <Icon name="home" />
              <span className="ac-menu__label">
                {t("shell.home")}
                <span className="ac-menu__desc">{t("shell.moreWhat.homePersonal")}</span>
              </span>
            </Link>
            <button
              type="button"
              className="ac-menu__item sidebar__more-item"
              onClick={() => {
                setOpen(false);
                openPalette();
              }}
            >
              <Icon name="search" />
              <span className="ac-menu__label">{t("palette.jump")}</span>
              <span className="sidebar__goto-keys" aria-hidden="true">
                <Kbd>{modKey()}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="ac-menu__separator" aria-hidden="true" />
          </>
        )}
        {items.map((id) => (
          <Link
            key={id}
            to={SIDEBAR_TOOLS[id].to}
            params={{ orgId: org.id }}
            className="ac-menu__item sidebar__more-item"
            onClick={() => setOpen(false)}
          >
            <Icon name={SIDEBAR_TOOLS[id].icon} />
            <span className="ac-menu__label">
              {t(`shell.${id}`)}
              <span className="ac-menu__desc">
                {t(personal && hasPersonalWhat(id) ? `shell.moreWhat.${id}Personal` : `shell.moreWhat.${id}`)}
              </span>
            </span>
            {countOf(id)}
          </Link>
        ))}
        <div className="ac-menu__separator" aria-hidden="true" />
        <button
          type="button"
          className="ac-menu__item sidebar__more-item"
          onClick={() => {
            setOpen(false);
            // Closing the dialog brings focus back to More, not to this line, gone with the panel.
            trigger.current?.focus();
            onCustomize();
          }}
        >
          <Icon name="settings" />
          <span className="ac-menu__label">{t("shell.customizeSidebar")}</span>
        </button>
      </Popover>
      {/* Proposals in More are a tab of Aprovações: its row lights up for them. */}
      <div className="sidebar__more-active">{items.filter((id) => id !== "proposals").map(row)}</div>
    </>
  );
}

/** One tool in the grid beside Go to… (`ToolLauncher`). */
type LauncherTool = { key: string; to: string; label: string; icon: ReactNode; hint?: string; count?: number };

/** The grid's groups, by what each tool is for; a tool no group names goes to the second. */
const LAUNCHER_GROUPS = [
  // The calendar is the posts' plan as much as the meetings': it sits with what clients approve.
  { id: "production", keys: ["portal", "review", "media", "drive", "calendar"] },
  { id: "work", keys: ["waiting", "issues", "whatsapp", "proposals"] },
  { id: "team", keys: ["routines", "taskManager", "team", "wiki", "dashboards"] },
] as const;

/**
 * Every tool at once (DougBot's team sidebar): a grid of icons and names in three groups, each tool where its count
 * shows, then what the person may create, then Personalizar. It opens beside the sidebar from the button at Go to…'s
 * end; the rows under Go to… keep the ones the person uses all day.
 */
function ToolLauncher({
  tools,
  create,
  onCustomize,
}: {
  tools: LauncherTool[];
  create: MenuEntry[];
  onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // In a phone's drawer there is no room beside it: the grid opens under Go to…, slid into the screen.
  const compact = useMediaQuery(COMPACT_QUERY);
  const named = new Set<string>(LAUNCHER_GROUPS.flatMap((g) => g.keys));
  const groups = LAUNCHER_GROUPS.map((g, i) => ({
    id: g.id,
    items: [
      ...g.keys.flatMap((key) => tools.filter((tool) => tool.key === key)),
      ...(i === 1 ? tools.filter((tool) => !named.has(tool.key)) : []),
    ],
  })).filter((g) => g.items.length > 0);
  const close = () => setOpen(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("shell.launcher.title")}
      side={compact ? "bottom" : "right"}
      align={compact ? "end" : "start"}
      // Past the sidebar's edge, not over its rows: the button sits 20 in from it, the panel 8 beyond.
      sideOffset={compact ? 8 : 28}
      className="sidebar__launcher"
      trigger={
        <Button
          ref={trigger}
          variant="ghost"
          iconOnly
          icon="grid"
          className="sidebar__launch"
          aria-label={t("shell.launcher.title")}
          title={t("shell.launcher.title")}
        />
      }
    >
      {groups.map((g) => (
        <section key={g.id} className="sidebar__launcher-group" aria-label={t(`shell.launcher.${g.id}`)}>
          <h3 className="sidebar__launcher-head">{t(`shell.launcher.${g.id}`)}</h3>
          <div className="sidebar__launcher-grid">
            {g.items.map((tool) => (
              <Link
                key={tool.key}
                to={tool.to}
                params={{ orgId: org.id }}
                className="sidebar__launcher-tile"
                title={tool.hint}
                onClick={close}
              >
                <span className="sidebar__launcher-icon" aria-hidden="true">
                  {tool.icon}
                  {(tool.count ?? 0) > 0 && <CountBadge>{badgeCount(tool.count ?? 0)}</CountBadge>}
                </span>
                <span className="sidebar__launcher-name">{tool.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {create.length > 0 && (
        <section className="sidebar__launcher-group" aria-label={t("shell.launcher.create")}>
          <h3 className="sidebar__launcher-head">{t("shell.launcher.create")}</h3>
          <div className="sidebar__launcher-create">
            {create.flatMap((entry) =>
              entry.kind === "item"
                ? [
                    <button
                      key={entry.id}
                      type="button"
                      className="sidebar__launcher-new"
                      onClick={() => {
                        close();
                        entry.run();
                      }}
                    >
                      <Icon name="plus" size={16} />
                      <span>{entry.label}</span>
                    </button>,
                  ]
                : [],
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        className="ac-link ac-link--muted small sidebar__launcher-customize"
        onClick={() => {
          close();
          // Closing the dialog brings focus back to the grid's button, not to this line, gone with the panel.
          trigger.current?.focus();
          onCustomize();
        }}
      >
        {t("shell.customizeSidebar")}
      </button>
    </Popover>
  );
}

/** A small pin at a pinned row's end, in place of its hover buttons. */
function PinnedMark() {
  const { t } = useTranslation();
  return (
    <span className="sidebar__item-meta sidebar__pinned" role="img" aria-label={t("sidebarPins.pinned")}>
      <Icon name="pin" size={14} />
    </span>
  );
}

/**
 * An agent in AGENTES (its row is its DM); while it works, a light sweep in its color runs behind the row (a pulse in
 * the rail) and the line under its name says for whom or where and how long, workspace-wide (its work for me, ADR 0084
 * addendum of 2026-11-13). For who manages agents it drags to another group (`drag`) and its right click has Mudar de
 * grupo (`menuExtra`). `live`: it works, waits or wrote to me, so a closed group still shows it.
 */
/** Doug: how many pinned agents the hero row shows; past it, a pinned agent stays in the list in its place, marked. */
const HERO_MAX = 4;

/**
 * Doug's pinned hero (after Nordus's PinnedHero): the agents pinned on top as a row of big glass faces under the search,
 * each with its name under it. Each is its DM's link, with the row's own right-click menu (pin, hide, group, settings),
 * its unread count on the face and its drag into a group, so nothing the row did is lost.
 */
function PinnedHero({
  agents,
  unreadOf,
  onPrefetch,
  onOpen,
  drag,
  menuExtra,
}: {
  agents: Agent[];
  unreadOf: (agentId: string) => number;
  onPrefetch: (agentId: string) => void;
  onOpen: (agentId: string) => void;
  drag?: (agentId: string) => ReturnType<ReturnType<typeof useAgentDrag>["row"]> | undefined;
  menuExtra: (a: Agent) => MenuEntry[];
}) {
  const { t } = useTranslation();
  return (
    <ul className="sidebar__hero" aria-label={t("sidebarPins.pinned")} data-count={agents.length}>
      {agents.map((a) => (
        <HeroAgent
          key={a.id}
          agent={a}
          unread={unreadOf(a.id)}
          onPrefetch={() => onPrefetch(a.id)}
          onOpen={() => onOpen(a.id)}
          drag={drag?.(a.id)}
          menuExtra={menuExtra(a)}
        />
      ))}
    </ul>
  );
}

function HeroAgent({
  agent: a,
  unread,
  onPrefetch,
  onOpen,
  drag,
  menuExtra,
}: {
  agent: Agent;
  unread: number;
  onPrefetch: () => void;
  onOpen: () => void;
  drag?: ReturnType<ReturnType<typeof useAgentDrag>["row"]>;
  menuExtra: MenuEntry[];
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const state = useStreams((st) => agentStateIn(st, a.id));
  const busy = state !== "idle";
  const shown = useAgentPresence(a.id);
  const word = shown ? t(`presence.${shown.presence}`) : null;
  const agentEntries = useAgentMenu();
  const rowMenu = entityMenu(() => agentEntries(a, menuExtra));
  return (
    <li className="sidebar__hero-item" data-hero-agent={a.id}>
      <Link
        {...rowMenu}
        to="/org/$orgId/dm/agent/$agentId"
        params={{ orgId: org.id, agentId: a.id }}
        className="sidebar__hero-link"
        title={[a.name, a.role, busy ? t(`sky.busy.${state}`) : word].filter(Boolean).join(" · ")}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onClick={onOpen}
        data-unread={unread > 0}
        data-busy={busy}
        {...drag}
      >
        <span className="sidebar__hero-face">
          <AgentAvatar
            agentId={a.id}
            name={a.name}
            size="lg"
            presence={shown?.presence ?? null}
            presenceLabel={word ?? undefined}
            asleep={isOutOfOffice(shown?.line)}
          />
          {unread > 0 && <UnreadCount count={unread} />}
        </span>
        <span className="sidebar__hero-name">{a.name}</span>
      </Link>
    </li>
  );
}

function AgentRow({
  agent: a,
  unread,
  waitingFor,
  live,
  pinned,
  onPrefetch,
  onOpen,
  drag,
  menuExtra,
}: {
  agent: Agent;
  unread: number;
  /** The offline computer it waits for (its brain runs there). */
  waitingFor?: string;
  live?: boolean;
  pinned?: boolean;
  onPrefetch: () => void;
  onOpen: () => void;
  drag?: ReturnType<ReturnType<typeof useAgentDrag>["row"]>;
  menuExtra?: MenuEntry[];
}) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const state = useStreams((st) => agentStateIn(st, a.id));
  const workingIn = useStreams((st) => agentWorkingIn(st, a.id));
  // Its presence from its work and its line (ADR 0084): the badge on its face, both in the row's title (no emoji in
  // the list: the line shows where the agent is opened).
  const shown = useAgentPresence(a.id);
  const work = shown?.work ?? null;
  // At work: a run this tab hears, or its work for me anywhere (work handed off in two agents' DM too).
  const busy = (state !== "idle" && !waitingFor) || work?.state === "working";
  const color = colorOf(a);
  const chip = audienceChip(t, a);
  // Background work's minutes move with the anchor's line, every half minute; its work's every minute.
  const clock = useNow(shown?.line?.kind === "work" || work !== null, work ? WORK_TICK_MS : 30_000);
  const word = shown ? agentFaceWord(t, shown.presence) : null;
  const line = agentLine(t, shown?.line ?? null, i18n.language);
  const dir = useDirectory(org.id);
  const channelList = useChannels(org.id).data;
  const here = workingIn ? channelList?.find((c) => c.id === workingIn)?.name : undefined;
  const channelName = (id: string) => channelList?.find((c) => c.id === id)?.name;
  const out = shown?.presence === "out" && line ? line.text : null;
  // Under its name: for whom or where it works, what it waits on, and for how long; a return it set comes after why it
  // is out.
  const doing =
    work?.state === "later" && out
      ? null
      : workLine(t, i18n.language, work, { agentName: (id) => dir.agentById.get(id)?.name, channelName }, clock);
  const navigate = useNavigate();
  const agentEntries = useAgentMenu();
  const rowMenu = entityMenu(() => agentEntries(a, menuExtra));
  // Its owner and the admins: its settings on hover, like a channel's.
  const edits = can(org, "manage_agents") || a.ownerUserId === me.user.id;
  // Listed for who manages agents though it doesn't talk to them: the line says who it talks to.
  const locked = !canTalk(a);
  const names = locked ? audienceNames(a, (id) => dir.memberById.get(id)?.name, dir.roleName) : [];
  // Working: the pixel orbit in its color beside its name (what it is on in its label and the row's title), so the
  // row never changes height.
  const working = busy || shown?.line?.kind === "work";
  const now = busy
    ? here
      ? t("sidebarAgents.workingIn", { channel: here })
      : state !== "idle"
        ? t(`sky.busy.${state}`)
        : agentFaceWord(t, "working")
    : working
      ? line?.text
      : undefined;
  // Under the name, one line of one height: its work (waiting on me, working, a wait, in line), why it is out, a return
  // it set, who it talks to when that is limited, else its role (the agent's fixed label) as a tag.
  const under =
    out ??
    (locked
      ? names.length > 1
        ? t("sidebarAgents.talksOnlyMore", { name: names[0], count: names.length - 1 })
        : names[0]
          ? t("sidebarAgents.talksOnly", { name: names[0] })
          : chip
      : a.role);
  // Its title: who it is over what it does, whole ("Ajudando a Ada · #vendas · 22 min", "Retorno às 00:32 · #vendas").
  const place =
    (work?.forAgentId || work?.state === "later") && work.channelId
      ? (work.channelName ?? channelName(work.channelId))
      : undefined;
  const doingTitle = doing
    ? [upperFirst(doing.text, i18n.language), place && `#${place}`, doing.time].filter(Boolean).join(" · ")
    : null;
  const title = doingTitle
    ? `${[a.name, a.role].filter(Boolean).join(" · ")}\n${doingTitle}`
    : [a.name, a.role, now ?? word, line?.text].filter(Boolean).join(" · ");
  const roleTag = !locked && !out;
  return (
    <div className="sidebar__row" data-agent-row={a.id} data-live={live || undefined} data-acts={edits ? 1 : undefined}>
      <Link
        {...rowMenu}
        to="/org/$orgId/dm/agent/$agentId"
        params={{ orgId: org.id, agentId: a.id }}
        className="sidebar__item"
        title={title}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onClick={onOpen}
        data-unread={unread > 0}
        data-busy={busy}
        data-presence={shown?.presence}
        style={{ ...selectionSky(color), "--sel-glow-color": agentGradient(color)[1] } as CSSProperties}
        {...drag}
      >
        {busy && <AgentTrail color={color} />}
        {busy && <AgentGlow color={color} />}
        <AgentAvatar
          agentId={a.id}
          name={a.name}
          size="sm"
          presence={shown?.presence ?? null}
          presenceLabel={word ?? undefined}
          asleep={isOutOfOffice(shown?.line)}
          {...(waitingFor ? { state: "idle" as const, expression: "closed" as const } : {})}
        />
        <span className="sidebar__item-text">
          <span className={doing || under ? "sidebar__item-label ac-captop" : "sidebar__item-label"}>
            {a.name}
            {working && (
              <PixelSpinner
                size={14}
                color={color}
                label={state === "idle" && doingTitle ? doingTitle : now}
                className="sidebar__item-spin"
              />
            )}
          </span>
          {doing ? (
            <AgentWorkLine line={doing} className="sidebar__item-role" />
          ) : (
            under && <span className={cx("sidebar__item-role", roleTag && "ac-tag")}>{under}</span>
          )}
        </span>
        {unread > 0 ? (
          <UnreadCount count={unread} />
        ) : waitingFor && !doing ? (
          <span className="sidebar__item-meta sidebar__waiting" title={t("outage.sidebar.tip", { name: waitingFor })}>
            <Icon name="waiting" size={14} />
            {t("outage.sidebar.waiting")}
          </span>
        ) : pinned ? (
          <PinnedMark />
        ) : (
          chip && (
            <span className="sidebar__item-meta sidebar__item-meta--audience">
              <span
                className="sidebar__lock"
                role="img"
                aria-label={chip}
                title={audienceNotice(t, a, (id) => dir.memberById.get(id)?.name, dir.roleName) || chip}
              >
                <Icon name="lock" size={14} />
              </span>
            </span>
          )
        )}
      </Link>
      {edits && (
        <span className="sidebar__row-acts">
          <RowAction
            icon="cog"
            label={t("shell.sidebarMenu.agentSettings", { name: a.name })}
            onClick={() => {
              if (requestAgentPanel(a.id, "settings")) return;
              onOpen();
              void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: a.id } });
            }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * The team's right hand (ADR 0137), always the first row of Agents, a plain row like any agent's: its face, its name
 * over its label as a tag ("your right hand"), a one-time "New" until its DM first opens (in this browser), and its
 * DM's unread count. It opens the
 * person's DM with it. Never sorted, pinned, dragged or hidden; a closed AGENTES still shows it.
 */
function RightHandRow({
  agent: a,
  unread,
  onPrefetch,
  onOpen,
}: {
  agent: Agent;
  unread: number;
  onPrefetch: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const fresh = rightHandSeen.useFresh(rightHandSeenKey(me.user.id, org.id));
  const shown = useAgentPresence(a.id);
  const label = t("rightHand.label");
  return (
    <Link
      to="/org/$orgId/dm/agent/$agentId"
      params={{ orgId: org.id, agentId: a.id }}
      className="sidebar__item"
      title={`${a.name} · ${label}`}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onClick={onOpen}
      data-unread={unread > 0}
      data-right-hand=""
    >
      <AgentAvatar agentId={a.id} name={a.name} size="sm" presence={shown?.presence ?? null} />
      <span className="sidebar__item-text">
        <span className="sidebar__item-label ac-captop">{a.name}</span>
        <span className="sidebar__item-role ac-tag">{label}</span>
      </span>
      {unread > 0 ? (
        <UnreadCount count={unread} />
      ) : (
        fresh && (
          <span className="sidebar__item-meta sidebar__new">
            <span className="sidebar__new-dot" aria-hidden="true" />
            {t("rightHand.newDot")}
          </span>
        )
      )}
    </Link>
  );
}

/** A person under "Mensagens diretas": their face with its presence badge, the name; their line in the title (ADR 0084). */
function PersonRow({
  member: m,
  unread,
  pinned,
  onPrefetch,
  onOpen,
}: {
  member: Member;
  unread: number;
  pinned?: boolean;
  onPrefetch: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const shown = usePersonPresence(m.userId);
  const word = shown ? t(`presence.${shown.presence}`) : null;
  const line = shown?.status ? personLine(shown.status) : null;
  const personEntries = usePersonMenu();
  return (
    <Link
      {...entityMenu(() => personEntries(m))}
      to="/org/$orgId/dm/person/$userId"
      params={{ orgId: org.id, userId: m.userId }}
      className="sidebar__item"
      title={[m.name, word, line?.text].filter(Boolean).join(" · ")}
      data-unread={unread > 0}
      data-presence={shown?.presence}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onClick={onOpen}
    >
      <Avatar
        name={m.name}
        size="sm"
        imageUrl={m.image}
        presence={shown?.presence ?? null}
        presenceLabel={word ?? undefined}
      />
      <span className="sidebar__item-label">{m.name}</span>
      {unread > 0 ? <UnreadCount count={unread} /> : pinned && <PinnedMark />}
    </Link>
  );
}

/**
 * The number on a row: in red what calls on me (a DM's unread messages, mentions of me in a channel), as Discord
 * counts; a channel's other unread messages in the kit's neutral count (`quiet`).
 */
function UnreadCount({
  count,
  mentions = false,
  quiet = false,
}: {
  count: number;
  mentions?: boolean;
  quiet?: boolean;
}) {
  const { t } = useTranslation();
  const props = {
    role: "img",
    "aria-label": t(mentions ? "shell.unreadMentions" : "shell.unread", { count }),
    children: badgeCount(count),
  };
  return quiet ? (
    <CountChip className="sidebar__unread sidebar__unread--quiet" {...props} />
  ) : (
    <CountBadge className="sidebar__unread" {...props} />
  );
}

/**
 * The account button: your face with your presence badge; under the name, your line (or how you appear). It opens a
 * menu right above it: you on top (face, name, @ and how you appear, your line in a well, a plan near its limit), then
 * your status (how you appear, or what you're up to), your profile, your settings (Configurações › Sua conta) and
 * signing out. The face on top changes your photo, as Editar perfil's Trocar foto does. Deleting the account starts at
 * the bottom of Sua conta, not here beside Sair, where a slip would open it. It and adding a password keep their
 * dialogs here, in the address (`?account=delete`, `?account=password`) on any page: adding a password may ask for a
 * sign-in again, which comes back.
 *
 * In a personal workspace (`personal`, ADR 0159) it is the sidebar's top row (face, name and ▾, no foot) and its menu,
 * opening down, also holds what the workspace menu held for one person: Your account, Settings and the person's
 * workspaces. Mounted once either way: the dialogs live here.
 */
/** The account's actions the full-screen menu's "Você" card runs (DougBot's head). */
interface AccountActions {
  status: () => void;
  profile: () => void;
  photo: () => void;
  account: () => void;
  signOut: () => void;
  who: { presence: MemberPresence | null; presenceWord?: string; handle?: string; line: string | null };
}

/**
 * The person's menu. On top (`personal`, or `head` in a team's workspace, DougBot's sidebar): their face, name and a
 * line under it (`sub`: the workspace and its counts), opening the workspaces to switch and the account's actions.
 */
function AccountMenu({
  personal = false,
  head = false,
  sub,
  onWorkspace,
  actions,
}: {
  personal?: boolean;
  head?: boolean;
  /** Opens the workspace's full-screen menu, which holds the account's actions too ("Você"): from the head, and as an
   * item of the menu at the rail's foot. */
  onWorkspace?: () => void;
  /** In the head: what the full-screen menu's "Você" card does, handed to it (the dialogs stay mounted here). */
  actions?: { current: AccountActions | null };
  /** Under the name in the head: the workspace, then its counts (each kept whole, one under the other if need be). */
  sub?: (string | null)[];
}) {
  const onTop = personal || head;
  const { t, i18n } = useTranslation();
  const { org, me: signedIn } = useOrg();
  const me = useMe().data ?? signedIn;
  const dir = useDirectory(org.id);
  const navigate = useNavigate();
  const compact = useMediaQuery(COMPACT_QUERY);
  const saveStatus = useSaveStatus();
  const [profile, setProfile] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [phone, setPhone] = useState(false);
  const [account, setAccount] = useOpenParam("account");
  const [statusOpen, setStatusOpen] = useState(false);
  // The app's "Show QR code" for this server (Preferences › Servers).
  useEffect(() => {
    if (takePhoneAsk()) setPhone(true);
    return onPhoneAsk(() => {
      takePhoneAsk();
      setPhone(true);
    });
  }, []);
  // Forgot password › Continue on this Mac (ADR 0158): signed in now, the new password it came for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the account menu mounts
  useEffect(() => {
    if (sessionStore.get(STORAGE_KEYS.newPasswordAsk) !== "1") return;
    sessionStore.remove(STORAGE_KEYS.newPasswordAsk);
    setAccount("password");
  }, []);
  const handle = dir.memberById.get(me.user.id)?.handle;
  // Where the operator lets people reach them (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`): the account menu's Support entry.
  const support = supportContactOf(useAuthConfig().data, me);
  // The page the person is on: what Support's draft names as where they came from.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // How you appear to yourself, read as the members column reads it (hidden stays hidden), and your line.
  const shown = usePersonPresence(me.user.id);
  const picked = shown?.person.availability;
  const presence = shown?.presence ?? null;
  const presenceWord = presence ? t(`presence.${presence}`) : undefined;
  const availability = picked ?? availabilityOf(shown?.presence);
  const line = shown?.status ? personLine(shown.status) : null;
  // Under your name: your line, or how you appear (Online, Ocupado, Ausente, Oculto) when you wrote none (ADR 0084).
  const who = [me.user.name, line?.text ?? presenceWord].filter(Boolean).join(" · ");
  const under = Boolean(line || presenceWord);

  const { signOut } = useSignOut();
  const openSettings = (section?: SettingsSection) =>
    void (section
      ? navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section } })
      : navigate({ to: "/org/$orgId/settings", params: { orgId: org.id } }));
  // Support's draft names where the person came from: the page they were on when they opened its entry.
  const openSupport = () => {
    setSupportCameFrom(pathname);
    openSettings("support");
  };
  if (actions)
    actions.current = {
      status: () => setStatusOpen(true),
      profile: () => setProfile(true),
      photo: () => setPhoto(true),
      account: () => openSettings("account"),
      signOut: () => void signOut(),
      who: { presence, presenceWord, handle, line: line?.text ?? null },
    };
  // A dialog opens once the menu is gone and focus is back on this row, so closing the dialog lands here too.
  const afterMenu = useRef<(() => void) | null>(null);
  const openAfter = (open: () => void) => () => {
    afterMenu.current = open;
  };
  // How you appear, then what you're up to: the dialog, with your line in it when you wrote one (it shows on top).
  const statusChoices = (
    <>
      <MenuRadioGroup
        label={t("presence.appearAs")}
        value={availability}
        onValueChange={(v) => v !== availability && saveStatus({ availability: v as Availability })}
        options={AVAILABILITIES.map((a) => ({
          value: a,
          label: t(`presence.${presenceOfAvailability(a)}`),
          leading: <PresenceBadge presence={presenceOfAvailability(a)} size="lg" ring={false} />,
        }))}
      />
      <MenuSeparator />
      <MenuItem icon="message" onSelect={openAfter(() => setStatusOpen(true))}>
        {t("presence.placeholder")}
      </MenuItem>
    </>
  );

  if (head)
    return (
      <>
        <button
          type="button"
          className="sidebar__org-button sidebar__org-button--me"
          aria-haspopup="dialog"
          aria-label={`${t("shell.account")}: ${who}`}
          title={who}
          onClick={onWorkspace}
        >
          <MyFace size="sm" presence={presence} presenceLabel={presenceWord} />
          <span className="sidebar__org-text">
            {/* The chevron follows the name, so the line under it keeps the row's width. */}
            <span className="sidebar__org-name">
              {me.user.name}
              <Icon name="chevronDown" size={16} />
            </span>
            {sub && (
              <span className="sidebar__org-meta">
                {/* The "·" before each part is drawn by the sheet: one that lands at a line's start is clipped. */}
                {sub.filter(Boolean).map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </span>
            )}
          </span>
        </button>
        <ProfileDialog focus={profile ? "name" : null} onClose={() => setProfile(false)} />
        <ChangeAvatarDialog open={photo} onClose={() => setPhoto(false)} />
        <SetStatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} />
        <OpenOnPhoneDialog open={phone} onClose={() => setPhone(false)} />
        <AddPasswordDialog open={account === "password"} onClose={() => setAccount(null)} />
        <DeleteAccountDialog open={account === "delete"} onClose={() => setAccount(null)} />
      </>
    );

  return (
    <>
      <Menu
        side={onTop ? "bottom" : "top"}
        className="profile-menu"
        onClosed={() => {
          afterMenu.current?.();
          afterMenu.current = null;
        }}
        trigger={
          onTop ? (
            // On top, as the workspace's header is in a team's: the face (how you appear on it) and the name.
            <button
              type="button"
              className="sidebar__org-button sidebar__org-button--me"
              aria-label={`${t("shell.account")}: ${who}`}
              title={who}
            >
              <MyFace size="sm" presence={presence} presenceLabel={presenceWord} />
              <span className="sidebar__org-text">
                {/* In the head the chevron follows the name, so the line under it keeps the row's width. */}
                <span className="sidebar__org-name">
                  {me.user.name}
                  {head && <Icon name="chevronDown" size={16} />}
                </span>
                {head && sub && (
                  <span className="sidebar__org-meta">
                    {/* The "·" before each part is drawn by the sheet: one that lands at a line's start is clipped. */}
                    {sub.filter(Boolean).map((part) => (
                      <span key={part}>{part}</span>
                    ))}
                  </span>
                )}
              </span>
              {!head && <Icon name="chevronDown" size={16} />}
            </button>
          ) : (
            <button
              type="button"
              // The face stands beside the lines under it (your status line): the name's capitals at its top. A name
              // alone (while how you appear loads) centres on it.
              className={cx("sidebar__user", under && "ac-faceline")}
              aria-label={`${t("shell.account")}: ${who}`}
              title={who}
            >
              <MyFace size="sm" presence={presence} presenceLabel={presenceWord} />
              <span className="sidebar__user-text">
                <span className={cx("sidebar__user-name", under && "ac-captop")}>{me.user.name}</span>
                {line ? (
                  <StatusLine emoji={line.emoji} text={line.text} className="sidebar__user-line" />
                ) : (
                  presenceWord && <StatusLine text={presenceWord} className="sidebar__user-line" />
                )}
              </span>
            </button>
          )
        }
      >
        <div className="profile-card__head profile-menu__head">
          <MenuFace label={t("photo.change")} onSelect={openAfter(() => setPhoto(true))}>
            <MyFace size="lg" presence={presence} presenceLabel={presenceWord} />
          </MenuFace>
          <span className="list-col">
            <span className="profile-card__name ac-captop">{me.user.name}</span>
            <span className="small muted">{[handle && `@${handle}`, presenceWord].filter(Boolean).join(" · ")}</span>
          </span>
        </div>
        {line && shown?.status && (
          <div className="profile-card__status profile-menu__line">
            <span className="profile-card__status-emoji" aria-hidden="true">
              {line.emoji}
            </span>
            <span>
              {line.text}
              <small>{statusEndNote(t, i18n.language, shown.status.until, true)}</small>
            </span>
          </div>
        )}
        <PlanNearLimitItem />
        <MenuSeparator />
        {/* A phone has no room beside the menu for another one: there the choices are in it. */}
        {compact ? (
          <>
            {statusChoices}
            <MenuSeparator />
          </>
        ) : (
          <MenuSub icon="smile" label={t("presence.setStatus")}>
            {statusChoices}
          </MenuSub>
        )}
        <MenuItem icon="edit" onSelect={openAfter(() => setProfile(true))}>
          {t("shell.editProfile")}
        </MenuItem>
        {personal && (
          <MenuItem icon="person" onSelect={() => openSettings("account")}>
            {t("settings.section.account")}
          </MenuItem>
        )}
        {/* Where the operator lets people reach them (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`): nowhere otherwise. */}
        {support ? (
          <MenuItem icon="question" onSelect={openSupport}>
            {t("settings.section.support")}
          </MenuItem>
        ) : null}
        {/* In a personal workspace: every section, what a team's workspace menu opens. In a team's: Your account. */}
        <MenuItem icon="settings" onSelect={() => openSettings(personal ? undefined : "account")}>
          {t("shell.settings")}
        </MenuItem>
        {import.meta.env.DEV && (
          <MenuItem icon="grid" onSelect={() => void navigate({ to: "/dev/gallery" })}>
            {t("shell.gallery")}
          </MenuItem>
        )}
        {onTop && (
          <>
            <MenuSeparator />
            {onWorkspace && (
              <MenuItem icon="settings" onSelect={openAfter(onWorkspace)}>
                {t("shell.workspaceMenuOf", { name: org.name })}
              </MenuItem>
            )}
            <MenuWorkspaces />
          </>
        )}
        {/* At the rail's foot: the workspace's own menu (its workspaces, members and settings), as no mark opens it there. */}
        {!onTop && onWorkspace && (
          <>
            <MenuSeparator />
            <MenuItem icon="grid" onSelect={openAfter(onWorkspace)}>
              {t("shell.workspaceMenuOf", { name: org.name })}
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon="arrowRight" danger onSelect={() => void signOut()}>
          {t("auth.signOut")}
        </MenuItem>
      </Menu>
      <ProfileDialog focus={profile ? "name" : null} onClose={() => setProfile(false)} />
      <ChangeAvatarDialog open={photo} onClose={() => setPhoto(false)} />
      <SetStatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} />
      <OpenOnPhoneDialog open={phone} onClose={() => setPhone(false)} />
      <EmailDialog open={account === "email"} onClose={() => setAccount(null)} />
      <AddPasswordDialog open={account === "password"} onClose={() => setAccount(null)} />
      <DeleteAccountDialog open={account === "delete"} onClose={() => setAccount(null)} />
    </>
  );
}

/**
 * A workspace in your lists of them (ADR 0159): a personal one of yours is you, by your photo and your name, as its
 * sidebar shows you; with more than one, your photo and each one's own name (the same name on each would tell them
 * apart by nothing). Any other (a team's, or a personal one shared with you, whose face would be someone else's) by its
 * mark and its name.
 */
function useWorkspaceLook() {
  const { me } = useOrg();
  const mine = (id: string) => {
    const o = me.organizations.find((m) => m.id === id);
    return o !== undefined && isPersonal(o) && o.role === "owner";
  };
  const several = me.organizations.filter((o) => mine(o.id)).length > 1;
  return (o: { id: string; name: string; logo?: string | null }, face: "sm" | "md", mark: number) =>
    mine(o.id)
      ? {
          leading: <Avatar kind="person" name={me.user.name} imageUrl={me.user.image} size={face} />,
          name: several ? o.name : me.user.name,
          sub: null,
          personal: true,
        }
      : { leading: <OrgMark logo={o.logo} name={o.name} size={mark} />, name: o.name, sub: null, personal: false };
}

/**
 * Your workspaces in the account menu of a personal workspace (ADR 0159): the workspace menu's list, then New
 * workspace when the person may make one. In the desktop app (ADR 0154) by server, then Add workspace; New workspace
 * (it makes one here) sits under this server's workspaces only on a server of one's own, since on DougBot Add
 * workspace makes one (`offersNewWorkspace`). Mounted only while the menu is open: the counts load then. No role beside
 * each: one person's own workspaces.
 */
function MenuWorkspaces() {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const look = useWorkspaceLook();
  const notes = workspaceNotes(t, i18n.language, me.organizations);
  const groups = useWorkspaceGroups({ orgs: me.organizations, currentOrgId: org.id });
  const api = useApi();
  const navigate = useNavigate();
  const go = (orgId: string) => void navigate({ to: "/org/$orgId", params: { orgId } });
  const newWorkspace = offersNewWorkspace(me.user.canCreateWorkspace, groups) && (
    <MenuItem icon="plus" onSelect={() => void navigate({ to: "/onboarding" })}>
      {t("shell.newWorkspace")}
    </MenuItem>
  );
  const addAccount = (
    <MenuItem
      icon="plus"
      description={t("shell.addAccountHint")}
      onSelect={() => void navigate({ to: "/login", search: { add: true } })}
    >
      {t("shell.addAccount")}
    </MenuItem>
  );
  if (groups)
    return (
      <>
        <MenuHeading>{t("shell.yourWorkspaces")}</MenuHeading>
        {groups.map((g) => (
          <Fragment key={groupKey(g)}>
            {groups.length > 1 && <MenuHeading>{groupTitle(t, g)}</MenuHeading>}
            {accountAlone(g) && (
              <MenuItem
                leading={<Avatar kind="person" name={g.account.name} size="sm" />}
                onSelect={() => void switchAccount(api, g.account.userId).catch(() => {})}
              >
                {g.account.name}
              </MenuItem>
            )}
            {g.rows.map((o) => {
              const shown = g.here ? look(o, "sm", 20) : look({ ...o, id: "" }, "sm", 20);
              return (
                <MenuItem
                  key={o.id}
                  leading={shown.leading}
                  description={[shown.sub, g.here ? notes.get(o.id) : null].filter(Boolean).join(" · ") || undefined}
                  hint={
                    o.current ? t("shell.youAreHere") : o.unread > 0 ? <CountChip>{o.unread}</CountChip> : undefined
                  }
                  onSelect={() => {
                    if (g.here) {
                      if (!o.current) go(o.id);
                    } else openElsewhere(api, g, o.id);
                  }}
                >
                  {shown.name}
                </MenuItem>
              );
            })}
            {g.here && newWorkspace}
          </Fragment>
        ))}
        {groups.some((g) => g.desktop) && (
          <MenuItem
            icon="plus"
            description={t("shell.addWorkspaceHint")}
            onSelect={() => void thisMac.addWorkspace().catch(() => {})}
          >
            {t("shell.addWorkspace")}
          </MenuItem>
        )}
        {addAccount}
      </>
    );
  return (
    <>
      <MenuHeading>{t("shell.yourWorkspaces")}</MenuHeading>
      {me.organizations.map((o) => {
        const shown = look(o, "sm", 20);
        return (
          <MenuItem
            key={o.id}
            leading={shown.leading}
            description={[shown.sub, notes.get(o.id)].filter(Boolean).join(" · ") || undefined}
            hint={o.id === org.id ? t("shell.youAreHere") : undefined}
            onSelect={() => o.id !== org.id && go(o.id)}
          >
            {shown.name}
          </MenuItem>
        );
      })}
      {newWorkspace}
      {addAccount}
    </>
  );
}

/** A group's key in "Your workspaces": a server has one group per account (ADR 0183). */
const groupKey = (g: WorkspaceGroup) => `${g.server} ${g.account?.userId ?? ""}`;

/**
 * A group's line in "Your workspaces" as words: its server in the desktop app (ADR 0154), and whose account it is
 * where a server has several (ADR 0183); outside the app there is one server, so the account alone.
 */
function groupTitle(t: TFunction, g: WorkspaceGroup): string {
  if (!g.desktop) return g.account?.email ?? g.name;
  const server = g.cloud ? g.name : `${g.name} · ${t("shell.yourServer")}`;
  return g.several && g.account ? `${server} · ${g.account.email}` : server;
}

/** Another account of this browser with no workspace yet: its own row is the way to it. */
const accountAlone = (g: WorkspaceGroup): g is WorkspaceGroup & { account: NonNullable<WorkspaceGroup["account"]> } =>
  g.sameServer && !g.here && g.account !== null && g.rows.length === 0;

/**
 * Opens a workspace that isn't the open account's: another account of this browser on this server (the browser moves
 * to it, ADR 0183), or another server of the desktop app (the window goes there, as the account it belongs to).
 */
function openElsewhere(api: ApiClient, g: WorkspaceGroup, orgId: string) {
  if (g.sameServer && g.account) void switchAccount(api, g.account.userId, `/org/${orgId}`).catch(() => {});
  else void thisMac.openWorkspace(g.server, orgId, g.account?.userId).catch(() => {});
}

/**
 * In the account menu, the one of your plans near or at its limit (from `PLAN_ALMOST`, 80%: "Quase no limite"), at
 * its limit first: its maker's mark, its name and its state, opening Configurações › Uso. Nothing otherwise. Your
 * accounts are read, and their usage looked up again (it comes back as `machine.updated`), when the menu opens.
 */
function PlanNearLimitItem() {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const api = useApi();
  const dir = useDirectory(org.id);
  const navigate = useNavigate();
  const plan = planNearLimit(ownPlanLines(t, useAiAccounts(org.id).data, dir.agents, me.user.id));
  useEffect(() => {
    void api.machines.refreshAccountUsage(org.id).catch(() => undefined);
  }, [api, org.id]);
  if (!plan) return null;
  return (
    <MenuItem
      leading={<ProviderLogo id={plan.logo} size="xs" />}
      hint={planWord(t, i18n.language, plan.usage)}
      onSelect={() =>
        void navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section: "usage" } })
      }
    >
      <span className="profile-menu__plan">{plan.name}</span>
    </MenuItem>
  );
}

/**
 * The workspace header ("Acme · 2 membros · 3 agentes") opens the workspace's
 * full-screen menu: invite, members, connectors,
 * agents' access, skills and settings as far as the role allows, then the
 * other workspaces to switch to.
 */
function WorkspaceMenu({
  summary,
  control,
  you,
}: {
  summary: string | null;
  /** DougBot's head: the person's own card ("Você") on the same full-screen menu. */
  you?: { current: AccountActions | null };
  /** Opened from elsewhere (DougBot's head: the person's menu), with no button of its own. */
  control?: { open: boolean; onOpenChange: (open: boolean) => void; anchor: RefObject<HTMLElement | null> };
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const place = useServerPlace();
  const [ownOpen, setOwnOpen] = useState(false);
  const own = useRef<HTMLButtonElement>(null);
  const open = control?.open ?? ownOpen;
  const setOpen = control?.onOpenChange ?? setOwnOpen;
  const trigger = control?.anchor ?? own;
  return (
    <>
      {!control && (
        <button
          ref={own}
          type="button"
          className="sidebar__org-button"
          aria-haspopup="dialog"
          aria-label={t("shell.workspaceMenuOf", { name: org.name })}
          onClick={() => setOpen(true)}
        >
          <OrgMark logo={org.logo} name={org.name} className="sidebar__org-mark" />
          <span className="sidebar__org-text">
            <span className="sidebar__org-name">{org.name}</span>
            {(place || summary) && (
              <span className="sidebar__org-line">
                {/* Where it lives, before its counts: the Cloud, this computer or one's own server. */}
                {place && (
                  <span className="sidebar__org-where">
                    <Icon name={SERVER_PLACE_ICON[place]} size={14} />
                    {t(`hosting.badge.${place}`)}
                  </span>
                )}
                {summary && <span className="sidebar__org-meta">{summary}</span>}
              </span>
            )}
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      )}
      <MenuOverlay
        open={open}
        onOpenChange={setOpen}
        anchor={trigger}
        closeLabel={t("common.close")}
        // DougBot: no pixel horizon under it; the workspace's logo, or the Doug drawn by code.
        mark={<OrgMark logo={org.logo} size={82} />}
        title={org.name}
        meta={
          <>
            {summary}
            {/* The agents the summary counts: the right hand isn't one of them, so no face beside "0 agents". */}
            {dir.agents.some((a) => !isRightHand(a)) && (
              <span className="sidebar__menu-crew">
                {/* The bots drawn by code, the Doug first (DougBot's chief). */}
                {[...dir.agents]
                  .filter((a) => !isRightHand(a) || a.handle === "doug")
                  .sort(
                    (x, y) =>
                      Number(y.handle === "doug" || isRightHand(y)) - Number(x.handle === "doug" || isRightHand(x)),
                  )
                  .slice(0, 4)
                  .map((a) => (
                    <AgentAvatar key={a.id} agent={a} name={a.name} size="xs" />
                  ))}
              </span>
            )}
          </>
        }
      >
        {you && <YouOptions actions={you} onDone={() => setOpen(false)} />}
        <WorkspaceMenuOptions onDone={() => setOpen(false)} />
      </MenuOverlay>
    </>
  );
}

/**
 * "Você" on the workspace's full-screen menu (DougBot's head): your face, name, @handle and how you appear, then your
 * status, profile, account settings and Sair. The dialogs live in the head's `AccountMenu`; this card runs them.
 */
function YouOptions({ actions, onDone }: { actions: { current: AccountActions | null }; onDone: () => void }) {
  const { t } = useTranslation();
  const { me } = useOrg();
  const a = actions.current;
  if (!a) return null;
  const run = (f: () => void) => () => {
    onDone();
    // After the full-screen menu is gone, so a dialog opens over the page.
    setTimeout(f, 0);
  };
  return (
    <MenuOverlayGroup heading={t("shell.you")}>
      <div className="mo-you">
        <MyFace size="lg" presence={a.who.presence} presenceLabel={a.who.presenceWord} />
        <span className="mo-you__text">
          <b className="mo-you__name">{me.user.name}</b>
          <span className="mo-you__line">
            {[a.who.handle && `@${a.who.handle}`, a.who.line ?? a.who.presenceWord].filter(Boolean).join(" · ")}
          </span>
        </span>
      </div>
      <MenuOverlayItem icon="smile" onSelect={run(a.status)}>
        {t("presence.setStatus")}
      </MenuOverlayItem>
      <MenuOverlayItem icon="edit" onSelect={run(a.profile)}>
        {t("shell.editProfile")}
      </MenuOverlayItem>
      <MenuOverlayItem icon="person" onSelect={run(a.account)}>
        {t("settings.section.account")}
      </MenuOverlayItem>
      <MenuOverlayItem icon="arrowRight" danger onSelect={run(a.signOut)}>
        {t("auth.signOut")}
      </MenuOverlayItem>
    </MenuOverlayGroup>
  );
}

/** The workspace menu's options (mounted only while open: the counts load then). */
function WorkspaceMenuOptions({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const look = useWorkspaceLook();
  const notes = workspaceNotes(t, i18n.language, me.organizations);
  const groups = useWorkspaceGroups({ orgs: me.organizations, currentOrgId: org.id });
  const api = useApi();
  const navigate = useNavigate();
  const overview = useOverview(org.id);
  const managesAgents = can(org, "manage_agents");
  const connections = useConnections(org.id);
  const skills = useSkills(org.id);
  const invite = useInviteDialog();
  const go = (section?: SettingsSection) => () => {
    onDone();
    void (section
      ? navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section } })
      : navigate({ to: "/org/$orgId/settings", params: { orgId: org.id } }));
  };
  // The workspace's invite dialog (ADR 0090), over the page this menu was opened on.
  const inviteNow = () => {
    if (invite) {
      onDone();
      invite.open();
    } else go("members")();
  };
  const newWorkspace = offersNewWorkspace(me.user.canCreateWorkspace, groups) && (
    <MenuOverlayItem
      icon="plus"
      onSelect={() => {
        onDone();
        void navigate({ to: "/onboarding" });
      }}
    >
      {t("shell.newWorkspace")}
    </MenuOverlayItem>
  );
  const addAccount = (
    <MenuOverlayItem
      icon="plus"
      description={t("shell.addAccountHint")}
      onSelect={() => {
        onDone();
        void navigate({ to: "/login", search: { add: true } });
      }}
    >
      {t("shell.addAccount")}
    </MenuOverlayItem>
  );
  let key = 0;
  const next = () => String(++key);
  return (
    <>
      <MenuOverlayGroup label={t("shell.workspaceMenuOf", { name: org.name })}>
        {can(org, "invite_people") && (
          <MenuOverlayItem icon="plus" shortcut={next()} description={t("shell.inviteHint")} onSelect={inviteNow}>
            {t("shell.invite")}
          </MenuOverlayItem>
        )}
        <MenuOverlayItem icon="members" shortcut={next()} count={overview.data?.people} onSelect={go("members")}>
          {t("shell.members")}
        </MenuOverlayItem>
        <MenuOverlayItem
          icon="plug"
          shortcut={next()}
          count={connections.data?.length || undefined}
          onSelect={go("connectors")}
        >
          {t("settings.section.connectors")}
        </MenuOverlayItem>
        {managesAgents && (
          <MenuOverlayItem icon="agent" shortcut={next()} onSelect={go("access")}>
            {t("settings.section.access")}
          </MenuOverlayItem>
        )}
        <MenuOverlayItem icon="book" shortcut={next()} count={skills.data?.length || undefined} onSelect={go("skills")}>
          {t("settings.section.skills")}
        </MenuOverlayItem>
        <MenuOverlayItem icon="settings" shortcut={next()} onSelect={go()}>
          {t("shell.workspaceSettings")}
        </MenuOverlayItem>
      </MenuOverlayGroup>
      <MenuOverlayGroup heading={t("shell.yourWorkspaces")}>
        {groups ? (
          <>
            {/* The desktop app (ADR 0154): every server's workspaces, by server, each with its unread count. */}
            {groups.map((g) => (
              <Fragment key={groupKey(g)}>
                {groups.length > 1 && !g.desktop && (
                  // Outside the app there is one server: each group is one of the browser's accounts (ADR 0183).
                  <span className="sidebar__menu-server">{g.account?.email ?? g.name}</span>
                )}
                {groups.length > 1 && g.desktop && (
                  <span className="sidebar__menu-server" data-state={g.state}>
                    <Icon name={g.cloud ? "cloud" : g.thisComputer ? "computer" : "globe"} size={14} />
                    {g.thisComputer ? t("shell.serverHere") : g.name}
                    {g.several && g.account && <em>· {g.account.email}</em>}
                    {/* Its state as words in the line, never a pill (ADR 0158): stopped, offline since, signed out. */}
                    {g.state === "offline" ? (
                      <em className="sidebar__menu-server-state">
                        ·{" "}
                        {g.thisComputer
                          ? t("shell.serverStopped")
                          : t("shell.serverOffline", {
                              time: formatTime(i18n.language, new Date(g.offlineSince ?? Date.now()).toISOString()),
                            })}
                      </em>
                    ) : g.state === "signedOut" ? (
                      <>
                        <em className="sidebar__menu-server-state">· {t("shell.serverSignedOut")} ·</em>
                        <button
                          type="button"
                          className="ac-link"
                          onClick={() => {
                            onDone();
                            void thisMac.openServer(g.server).catch(() => thisMac.otherServer().catch(() => {}));
                          }}
                        >
                          {t("shell.serverSignIn")}
                        </button>
                      </>
                    ) : (
                      !g.cloud && !g.thisComputer && <em>· {t("shell.yourServer")}</em>
                    )}
                  </span>
                )}
                {accountAlone(g) && (
                  <MenuOverlayItem
                    leading={<Avatar kind="person" name={g.account.name} size="md" />}
                    onSelect={() => {
                      onDone();
                      void switchAccount(api, g.account.userId).catch(() => {});
                    }}
                  >
                    {g.account.name}
                  </MenuOverlayItem>
                )}
                {g.rows.map((o) => {
                  const here = g.here ? me.organizations.find((m) => m.id === o.id) : undefined;
                  const shown = look(here ? o : { ...o, id: "" }, "md", 32);
                  return (
                    <MenuOverlayItem
                      key={o.id}
                      leading={
                        // A server not answering: its last workspaces, dimmed.
                        <span className={g.state === "offline" ? "sidebar__menu-dim" : undefined}>{shown.leading}</span>
                      }
                      description={
                        here
                          ? [shown.personal ? shown.sub : t(`roles.${here.role}`), notes.get(o.id)]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          : undefined
                      }
                      current={o.current}
                      hint={
                        o.current ? t("shell.youAreHere") : o.unread > 0 ? <CountChip>{o.unread}</CountChip> : undefined
                      }
                      onSelect={() => {
                        onDone();
                        if (!g.here) openElsewhere(api, g, o.id);
                        else if (!o.current) void navigate({ to: "/org/$orgId", params: { orgId: o.id } });
                      }}
                    >
                      {shown.name}
                    </MenuOverlayItem>
                  );
                })}
                {g.here && newWorkspace}
              </Fragment>
            ))}
            <MenuOverlaySeparator />
            {groups.some((g) => g.desktop) && (
              <MenuOverlayItem
                icon="plus"
                description={t("shell.addWorkspaceHint")}
                onSelect={() => {
                  onDone();
                  void thisMac.addWorkspace().catch(() => {});
                }}
              >
                {t("shell.addWorkspace")}
              </MenuOverlayItem>
            )}
            {addAccount}
          </>
        ) : (
          <>
            {me.organizations.map((o) => {
              const shown = look(o, "md", 32);
              return (
                <MenuOverlayItem
                  key={o.id}
                  leading={shown.leading}
                  description={
                    [shown.personal ? shown.sub : t(`roles.${o.role}`), notes.get(o.id)].filter(Boolean).join(" · ") ||
                    undefined
                  }
                  current={o.id === org.id}
                  hint={o.id === org.id ? t("shell.youAreHere") : undefined}
                  onSelect={() => {
                    onDone();
                    if (o.id !== org.id) void navigate({ to: "/org/$orgId", params: { orgId: o.id } });
                  }}
                >
                  {shown.name}
                </MenuOverlayItem>
              );
            })}
            <MenuOverlaySeparator />
            {newWorkspace}
            {addAccount}
          </>
        )}
      </MenuOverlayGroup>
    </>
  );
}
