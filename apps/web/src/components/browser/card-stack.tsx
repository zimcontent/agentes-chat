import { formatTime } from "@dougbot/client/lib/format";
import { agentGradient, Icon } from "@dougbot/ui";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { useDirectory } from "@/hooks/useDirectory";
import { useOrg } from "../org-context";
import { colorOf } from "../Sky";
import { SiteIcon } from "./SiteIcon";
import "./browser.css";

/**
 * One agent has one browser, so a conversation shows its page once: each turn that used it has a live card, and only
 * the newest of an agent's cards in one timeline shows the page; the ones above it fold into a line that opens on
 * request. The card the person is in control on stays open whatever its place (they hand back from it).
 */
export interface BrowserCardStack {
  register(id: string, entry: StackEntry): () => void;
  subscribe(listener: () => void): () => void;
  /** Whether this card folds: another card of its agent here comes after it (or is the one in control). */
  folded(id: string): boolean;
}

interface StackEntry {
  agentId: string;
  el: Element;
  /** The person is in control on this card: it stays open, and the others of its agent fold. */
  keep: boolean;
}

export function createBrowserCardStack(): BrowserCardStack {
  const entries = new Map<string, StackEntry>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of listeners) l();
  };
  /** Whether `b` comes after `a` in the page. */
  const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return {
    register(id, entry) {
      entries.set(id, entry);
      changed();
      return () => {
        if (entries.get(id) !== entry) return;
        entries.delete(id);
        changed();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    folded(id) {
      const me = entries.get(id);
      if (!me) return false;
      let shown: [string, StackEntry] | null = null;
      for (const pair of entries) {
        const [, e] = pair;
        if (e.agentId !== me.agentId) continue;
        const [, best] = shown ?? [];
        if (!best || (e.keep && !best.keep) || (e.keep === best.keep && after(best.el, e.el))) shown = pair;
      }
      return shown !== null && shown[0] !== id;
    },
  };
}

const StackContext = createContext<BrowserCardStack | null>(null);

/** One timeline's cards (a conversation, a thread in its panel): outside one, every card shows its page. */
export function BrowserCardStackProvider({ stack, children }: { stack: BrowserCardStack; children: ReactNode }) {
  return <StackContext.Provider value={stack}>{children}</StackContext.Provider>;
}

const never = () => () => {};

/**
 * A live browser card of `agentId` in this timeline: the newest shows the card, older ones a line that opens it
 * (`FoldedBrowserCard`). `keep`: the person is in control on it.
 */
export function StackedBrowserCard({
  agentId,
  keep,
  host,
  path = "",
  at,
  children,
}: {
  agentId: string;
  keep: boolean;
  /** Where it browsed, for the line: the site and its path (`hostAndPath`). */
  host: string | null;
  path?: string;
  /** When (the run's start, or its message), for the line. */
  at: string | number | null;
  children: ReactNode;
}) {
  const stack = useContext(StackContext);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!stack || !el) return;
    return stack.register(id, { agentId, el, keep });
  }, [stack, id, agentId, keep]);
  const folded = useSyncExternalStore(
    stack?.subscribe ?? never,
    () => stack?.folded(id) ?? false,
    () => false,
  );
  const [open, setOpen] = useState(false);
  return (
    <div ref={box} className="brw-stack">
      {folded ? (
        <FoldedBrowserCard
          agentId={agentId}
          host={host}
          path={path}
          at={at}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      ) : null}
      {!folded || open ? children : null}
    </div>
  );
}

/** An earlier card of an agent's browser in this timeline, folded: "Navegador · site · 12:48", opening the card. */
export function FoldedBrowserCard({
  agentId,
  host,
  path = "",
  at,
  open,
  onToggle,
}: {
  agentId: string;
  host: string | null;
  path?: string;
  at: string | number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const [top, bottom] = agentGradient(colorOf(dir.agentById.get(agentId)));
  const time = at === null ? null : formatTime(i18n.language, typeof at === "number" ? new Date(at).toISOString() : at);
  const toggle = open ? t("browser.watch.hideScreen") : t("browser.watch.showScreen");
  return (
    <div
      className={open ? "brw-trail brw-mf-end brw-stack__line is-open" : "brw-trail brw-mf-end brw-stack__line"}
      style={{ "--mf-a": top, "--mf-b": bottom } as CSSProperties}
    >
      <button type="button" className="brw-mf-end__row" aria-expanded={open} title={toggle} onClick={onToggle}>
        {host ? <SiteIcon host={host} /> : <Icon name="globe" size={14} />}
        <b>{host ? t("browser.watch.foldedAt", { site: `${host}${path}` }) : t("browser.watch.folded")}</b>
        <span className="brw-grow" />
        {time && <span className="brw-mf-end__sum">{time}</span>}
        <span className="ac-visually-hidden">{toggle}</span>
        <Icon name="chevronDown" size={14} className="brw-mf-end__chev" />
      </button>
    </div>
  );
}
