import { BoardPages } from "./BoardPages";

export { openNewBoard } from "./BoardPages";

/**
 * Dashboards, pushed from the home's tools and the account's list (ADR 0135): the boards as pages side by side, My Home
 * first (`BoardPages`).
 */
export function DashboardsScreen() {
  return <BoardPages />;
}
