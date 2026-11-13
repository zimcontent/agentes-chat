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

/** The Mac menu bar's New agent (`MenuBarActions`, mounted outside the dialog's provider) asks through this event. */
export const NEW_AGENT_EVENT = "agentes:new-agent";

/** File → Novo canal in the desktop app's menu bar (DesktopMenus.tsx): the sidebar opens its dialog. */
export const NEW_CHANNEL_EVENT = "agentes:new-channel";

/** Tablet widths: the sidebar is always an icon rail (NavDrawer.tsx has the other breakpoints). */
export const TABLET_QUERY = "(min-width: 761px) and (max-width: 1199px)";

/**
 * The sidebar shrunk to its icon rail at desktop widths (remembered), shared with the Mac app's title bar,
 * which carries the toggle there (DesktopTitleBar.tsx). In memory too, for when storage is blocked.
 */
const SIDEBAR_EVENT = "agentes:sidebar";
let sidebarCollapsed = storage.get(STORAGE_KEYS.sidebarCollapsed) === "1";
const onSidebarChange = (cb: () => void) => {
  window.addEventListener(SIDEBAR_EVENT, cb);
  return () => window.removeEventListener(SIDEBAR_EVENT, cb);
};
export const toggleSidebar = () => {
  sidebarCollapsed = !sidebarCollapsed;
  storage.set(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
};
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    onSidebarChange,
    () => sidebarCollapsed,
    () => false,
  );
  return [collapsed, toggleSidebar];
}
