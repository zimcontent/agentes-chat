import { BoardPages } from "./BoardPages";

export { newWidgetHref } from "./BoardPages";

/**
 * A dashboard, pushed from a notification, a link or a widget (ADR 0135): Dashboards' pages opened on this board
 * (`home` for My Home, made the first time it is opened), the others a swipe away.
 */
export function BoardScreen({ id }: { id: string }) {
  return <BoardPages initial={id} />;
}
