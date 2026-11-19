import { useSyncExternalStore } from "react";
import { STORAGE_KEYS, storage } from "@/lib/storage";

/*
 * Doug: the shell's small shared pieces (events, the sidebar's collapsed state, a breakpoint), kept apart from the
 * screens that own them. The root route and the error screen use them, and those load before the first paint: when
 * they came from Sidebar.tsx, CommandMenu.tsx and NewAgentDialog.tsx, every page (the sign-in included) downloaded the
 * whole workspace up front. Those modules re-export them, so their other importers are unchanged.
 */

/** Opens the palette from elsewhere (a button). */
export const openPalette = () => window.dispatchEvent(new Event("agentes:palette"));

/**
 * Who sits outside the new agent dialog's provider asks through this event: the Mac menu bar's New agent
 * (`MenuBarActions`), and Connect AI's "Criar um agente com este plano" (a `CustomEvent` whose `detail` is the request).
 */
export const NEW_AGENT_EVENT = "agentes:new-agent";

/** File → Novo canal in the desktop app's menu bar (DesktopMenus.tsx): the sidebar opens its dialog. */
export const NEW_CHANNEL_EVENT = "agentes:new-channel";

/** Tablet widths: the sidebar starts as an icon rail (NavDrawer.tsx has the other breakpoints). */
export const TABLET_QUERY = "(min-width: 761px) and (max-width: 1199px)";

/**
 * The sidebar shrunk to its icon rail, shared with the Mac app's title bar, which carries the toggle there
 * (DesktopTitleBar.tsx). Desktop widths remember the person's choice (in memory too, for when storage is blocked).
 * Tablet widths start as the rail every time: their toggle opens the whole sidebar over the page until a link, Esc,
 * a click outside or the toggle closes it, since the page's tablet layout has no room for it beside.
 */
const SIDEBAR_EVENT = "agentes:sidebar";
let sidebarCollapsed = storage.get(STORAGE_KEYS.sidebarCollapsed) === "1";
let tabletOpen = false;
const tabletMedia = () => (typeof window.matchMedia === "function" ? window.matchMedia(TABLET_QUERY) : null);
const isTablet = () => tabletMedia()?.matches ?? false;
const onSidebarChange = (cb: () => void) => {
  const media = tabletMedia();
  window.addEventListener(SIDEBAR_EVENT, cb);
  media?.addEventListener("change", cb);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, cb);
    media?.removeEventListener("change", cb);
  };
};
export const toggleSidebar = () => {
  if (isTablet()) tabletOpen = !tabletOpen;
  else {
    sidebarCollapsed = !sidebarCollapsed;
    storage.set(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0");
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
};
/** A tablet's open sidebar back to its rail. */
export const closeTabletSidebar = () => {
  if (!tabletOpen) return;
  tabletOpen = false;
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
};
/** Whether the sidebar is its icon rail at this width (a phone's drawer never reads it), and its toggle. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    onSidebarChange,
    () => (isTablet() ? !tabletOpen : sidebarCollapsed),
    () => false,
  );
  return [collapsed, toggleSidebar];
}
