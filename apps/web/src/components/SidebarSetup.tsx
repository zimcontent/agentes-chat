import type { SidebarItem, SidebarPlace } from "@agenteschat/client";
import {
  useAuthConfig,
  useClientLook,
  useSetSidebarItem,
  useSetSidebarToolOrder,
  useSidebarItems,
  useSidebarToolOrder,
} from "@agenteschat/client";
import { hiddenToolsWith } from "@agenteschat/client/lib/client-custom";
import {
  moveSection,
  moveShownTool,
  placeTool,
  portalHere,
  SIDEBAR_COUNTED,
  sameOrder,
  sidebarItemOrder,
  sidebarPlace,
  sidebarSections,
} from "@agenteschat/client/lib/sidebar-items";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  type IconName,
  Segmented,
  type SegmentedOption,
} from "@agenteschat/ui";
import {
  cloneElement,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useOrg, useOrgIfAny } from "./org-context";
import { sectionName, useSectionOrder } from "./SidebarOrder";

/** The tools at the top of the sidebar: the page each opens and its icon. */
export const SIDEBAR_TOOLS = {
  waiting: { to: "/org/$orgId/waiting", icon: "question" },
  portal: { to: "/org/$orgId/portal", icon: "approve" },
  media: { to: "/org/$orgId/media", icon: "image" },
  approvals: { to: "/org/$orgId/approvals", icon: "waiting" },
  proposals: { to: "/org/$orgId/proposals", icon: "bulb" },
  threads: { to: "/org/$orgId/threads", icon: "thread" },
  issues: { to: "/org/$orgId/issues", icon: "issues" },
  wiki: { to: "/org/$orgId/wiki", icon: "book" },
  drive: { to: "/org/$orgId/drive", icon: "drive" },
  routines: { to: "/org/$orgId/routines", icon: "routines" },
  calendar: { to: "/org/$orgId/calendar", icon: "calendar" },
  team: { to: "/org/$orgId/team", icon: "agent" },
  dashboards: { to: "/org/$orgId/dashboards", icon: "chart" },
  taskManager: { to: "/org/$orgId/task-manager", icon: "stageProgress" },
} as const satisfies Record<SidebarItem, { to: string; icon: IconName }>;

/** Whether the server's approval portal is this workspace's (ADR 9001 §18): Portal is a tool only there. */
export const usePortalOn = () => portalHere(useOrgIfAny()?.org, useAuthConfig().data?.approvalPortal);
/** Whether the server generates images and videos from a credit wallet (ADR doug-0011): Mídia is a tool only there. */
export const useMediaOn = () => useAuthConfig().data?.zimMedia === true;
/**
 * The tools this workspace doesn't show: the ones an admin took out for everyone (Settings › General) and the ones this
 * server's client turns off for every workspace of its own (ADR doug-0020), once each.
 */
export const useHiddenTools = (): readonly string[] => {
  const hidden = useOrgIfAny()?.org.hiddenTools;
  const client = useClientLook();
  return useMemo(() => hiddenToolsWith(client, hidden ?? []), [client, hidden]);
};
/**
 * The tools this sidebar lists: Portal only where the approval portal is the workspace's, so nothing changes without
 * one, none an admin took out of the workspace (`hidden`), and never Aprovações, which is a tab of "Esperando você"
 * (ADR 0172 addendum): one entry and one count for all that waits on the person.
 */
export const toolsHere = <T extends SidebarItem>(
  ids: readonly T[],
  portal: boolean,
  hidden: readonly string[] = [],
  media = false,
): T[] =>
  ids.filter(
    (id) =>
      id !== "approvals" &&
      // Threads aren't a place of their own (ADR doug-0018): work is in Tarefas, a thread opens from its channel.
      id !== "threads" &&
      (portal || id !== "portal") &&
      (media || id !== "media") &&
      !hidden.includes(id),
  );

/**
 * The person's order of the tools in this workspace (`…/me/sidebar/tools`), saved as `null` when it is the default of
 * the workspace's mode (`personal`, ADR 0159). `put(next, from)` keeps the focus on `from` (or, once it is disabled at
 * an end, its row's other arrow): React moves a row down by re-inserting its node, which blurs whatever was focused
 * inside it.
 */
function useToolOrder(orgId: string, personal = false) {
  const order = useSidebarToolOrder(orgId, personal);
  const save = useSetSidebarToolOrder(orgId, personal);
  const focused = useRef<HTMLElement | null>(null);
  const key = order.join();
  useLayoutEffect(() => {
    const el = focused.current;
    focused.current = null;
    if (!key || !el?.isConnected) return;
    (el.matches(":disabled")
      ? el.parentElement?.querySelector<HTMLElement>("[data-move]:not(:disabled)")
      : el
    )?.focus();
  }, [key]);
  const put = (next: SidebarItem[], from?: Element) => {
    if (sameOrder(next, order)) return;
    if (from instanceof HTMLElement) focused.current = from;
    save.mutate(sameOrder(next, sidebarItemOrder(personal)) ? null : next);
  };
  return { order, put };
}

const TOOL_DRAG = "application/x-agentes-tool";
/** The two tools that share a row in the list: what waits on me, and the portal where clients approve (ADR 9001). */
export const TOOL_PAIR: readonly SidebarItem[] = ["waiting", "portal"];
const MOVE_KEYS = "Alt+Shift+ArrowUp Alt+Shift+ArrowDown";

/**
 * The tools shown in the sidebar's list, in the person's order: each dragged onto another goes before or after it,
 * and Alt+Shift+↑/↓ on a focused one moves it past its neighbour (the setup dialog's arrows do it too). The rows stay
 * the links `row` makes, so the browser's own menu on them is kept. Each shows its own grip on hover: the row is what
 * moves, so a mouse drags from anywhere on it and a click on the grip doesn't open the tool. With an approval portal
 * (ADR 9001), "Waiting on you" and Portal share one row while both are in the list (`TOOL_PAIR`), where the first of
 * the two is in the person's order: two smaller buttons side by side, each still its own link that moves on its own.
 */
export function ToolList({
  items,
  row,
  after,
}: {
  items: SidebarItem[];
  row: (id: SidebarItem) => ReactElement;
  /** A row of another kind (DougBot's Revisão) right after this tool, or at the list's end when it isn't shown. */
  after?: { id: SidebarItem; node: ReactNode };
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { order, put } = useToolOrder(org.id, isPersonal(org));
  const dragging = useRef<SidebarItem | null>(null);
  const [mark, setMark] = useState<{ id: SidebarItem; where: "before" | "after" } | null>(null);
  const shown = order.filter((id) => items.includes(id));
  const end = () => {
    dragging.current = null;
    setMark(null);
  };
  const paired = TOOL_PAIR.every((id) => shown.includes(id));
  const tool = (id: SidebarItem) => {
    const link = row(id) as ReactElement<{ children?: ReactNode }>;
    return cloneElement(link as ReactElement<Record<string, unknown>>, {
      children: (
        <>
          {link.props.children}
          <span
            className="sidebar__tool-grip"
            aria-hidden="true"
            title={t("shell.sidebarSetup.moveTool", { name: t(`shell.${id}`) })}
            onClick={(e) => e.preventDefault()}
          >
            <Icon name="grip" size={14} />
          </span>
        </>
      ),
      draggable: true,
      "aria-keyshortcuts": MOVE_KEYS,
      "data-drop": mark?.id === id ? mark.where : undefined,
      onKeyDown: (e: KeyboardEvent) => {
        if (!e.altKey || !e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        put(moveShownTool(order, shown, id, e.key === "ArrowUp" ? -1 : 1), e.currentTarget);
      },
      onDragStart: (e: DragEvent) => {
        dragging.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TOOL_DRAG, id);
      },
      onDragOver: (e: DragEvent) => {
        const from = dragging.current;
        if (!from || from === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const where = e.clientY > r.top + r.height / 2 ? "after" : "before";
        if (mark?.id !== id || mark.where !== where) setMark({ id, where });
      },
      onDrop: (e: DragEvent) => {
        const from = dragging.current;
        const m = mark;
        end();
        if (!from || !m) return;
        e.preventDefault();
        put(placeTool(order, from, m.id, m.where));
      },
      onDragEnd: end,
    });
  };
  const first = paired ? shown.find((id) => TOOL_PAIR.includes(id)) : undefined;
  const list = shown
    .filter((id) => !paired || id === first || !TOOL_PAIR.includes(id))
    .map((id) =>
      id === first ? (
        <div key="pair" className="sidebar__pair">
          {TOOL_PAIR.map(tool)}
        </div>
      ) : (
        tool(id)
      ),
    );
  if (!after) return list;
  // After the tool, or after the pair that holds it.
  const at = shown.includes(after.id)
    ? shown
        .filter((id) => !paired || id === first || !TOOL_PAIR.includes(id))
        .findIndex((id) => id === after.id || (paired && id === first && TOOL_PAIR.includes(after.id)))
    : -1;
  const extra = <Fragment key="after">{after.node}</Fragment>;
  return at < 0 ? [...list, extra] : [...list.slice(0, at + 1), extra, ...list.slice(at + 1)];
}

/**
 * "Personalizar a barra lateral", from More: one line per tool and where it goes, Sempre, Em Mais or, for a tool with
 * a count, Quando tiver algo. A choice applies at once (no Save) and is kept on the server for this person in this
 * workspace, so their other devices and the desktop app show the same sidebar. What shows before any choice, and what
 * Reset to default goes back to, is the workspace's mode's (ADR 0159).
 */
export function SidebarSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const personal = isPersonal(org);
  const { data: items, refetch } = useSidebarItems(org.id);
  const save = useSetSidebarItem(org.id, personal);
  const sections = useSectionOrder(org.id, personal);
  const tools = useToolOrder(org.id, personal);
  const shown = toolsHere(tools.order, usePortalOn(), useHiddenTools(), useMediaOn());
  // What another device changed since this one loaded shows as the dialog opens.
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);
  const options = (id: SidebarItem): SegmentedOption<SidebarPlace>[] => [
    { value: "always", label: t("shell.sidebarSetup.always") },
    { value: "more", label: t("shell.sidebarSetup.more") },
    ...(SIDEBAR_COUNTED.includes(id)
      ? [{ value: "auto" as const, label: t("shell.sidebarSetup.auto"), title: t("shell.sidebarSetup.autoHint") }]
      : []),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("shell.customizeSidebar")}
      description={t("shell.sidebarSetup.description")}
      closeLabel={t("common.close")}
      width={640}
    >
      <DialogBody>
        <ul className="sidebar-setup">
          {shown.map((id, i) => (
            <li key={id} className="sidebar-setup__row">
              <span className="settings-row__icon" aria-hidden="true">
                <Icon name={SIDEBAR_TOOLS[id].icon} size={16} />
              </span>
              <span className="sidebar-setup__name">{t(`shell.${id}`)}</span>
              <Segmented
                block
                size="sm"
                label={t(`shell.${id}`)}
                value={sidebarPlace(items, id, personal)}
                onValueChange={(place) => save.mutate({ item: id, place })}
                options={options(id)}
              />
              <span className="sidebar-setup__moves">
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="chevronUp"
                  aria-label={`${t("contextMenu.moveUp")}: ${t(`shell.${id}`)}`}
                  data-move
                  disabled={i === 0}
                  onClick={(e) => tools.put(moveShownTool(tools.order, shown, id, -1), e.currentTarget)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="chevronDown"
                  aria-label={`${t("contextMenu.moveDown")}: ${t(`shell.${id}`)}`}
                  data-move
                  disabled={i === shown.length - 1}
                  onClick={(e) => tools.put(moveShownTool(tools.order, shown, id, 1), e.currentTarget)}
                />
              </span>
            </li>
          ))}
        </ul>
        <div className="ac-field__label-row">
          <h3 className="sidebar-setup__heading">{t("shell.sidebarSetup.order")}</h3>
          <button
            type="button"
            className="ac-link ac-link--muted small"
            disabled={sameOrder(sections.order, sidebarSections(personal))}
            onClick={() => sections.put([...sidebarSections(personal)])}
          >
            {t("contextMenu.restoreOrder")}
          </button>
        </div>
        <p className="small muted sidebar-setup__hint">{t("shell.sidebarSetup.orderHint")}</p>
        <ol className="sidebar-setup sidebar-setup--order">
          {sections.order.map((id, i) => (
            <li key={id} className="sidebar-setup__row" data-section={id}>
              <span className="settings-row__icon ac-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="sidebar-setup__name">{sectionName(t, id, personal)}</span>
              <span className="sidebar-setup__moves">
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="chevronUp"
                  aria-label={`${t("contextMenu.moveUp")}: ${sectionName(t, id, personal)}`}
                  disabled={i === 0}
                  onClick={() => sections.put(moveSection(sections.order, id, -1))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="chevronDown"
                  aria-label={`${t("contextMenu.moveDown")}: ${sectionName(t, id, personal)}`}
                  disabled={i === sections.order.length - 1}
                  onClick={() => sections.put(moveSection(sections.order, id, 1))}
                />
              </span>
            </li>
          ))}
        </ol>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          icon="undo"
          disabled={Object.keys(items ?? {}).length === 0 && sameOrder(tools.order, sidebarItemOrder(personal))}
          onClick={() => {
            save.mutate(null);
            tools.put([...sidebarItemOrder(personal)]);
          }}
        >
          {t("shell.sidebarSetup.reset")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
