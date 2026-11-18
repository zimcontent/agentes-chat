import { isUuid } from "./format";

/** A block's place to open (`BlockOpen` in `@agenteschat/ui/blocks/spec`, which this package doesn't import). */
export interface BlockOpen {
  place: string;
  id?: string;
  sub?: string;
  href?: string;
}

/**
 * Where a card's "open" button goes (docs/adr/doug-0020-doug-sector-cards.md §4): the same place on the web and the
 * phone, each in its own routes. An id that isn't one is left out (the place's list opens instead); `link` is an
 * outside address, https only (the spec checked it, and this checks again: a block's content came from the server,
 * but a check costs nothing).
 */
export type OpenTarget =
  | { kind: "app"; path: string; search?: Record<string, string> }
  | { kind: "outside"; href: string }
  | null;

const https = (href: string | undefined) => (href && /^https:\/\/\S+$/.test(href) ? href : null);
const uuid = (v: string | undefined) => (v && isUuid(v) ? v : undefined);
const taskNumber = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) ? v : undefined);

/** The web's route under `/org/{orgId}`, or an outside address. */
export function blockOpenWeb(orgId: string, open: BlockOpen): OpenTarget {
  const base = `/org/${orgId}`;
  switch (open.place) {
    case "whatsapp": {
      const account = uuid(open.id);
      const chat = account ? uuid(open.sub) : undefined;
      return {
        kind: "app",
        path: `${base}/whatsapp`,
        ...(account ? { search: { account, ...(chat ? { chat } : {}) } } : {}),
      };
    }
    case "proposals":
      return { kind: "app", path: `${base}/proposals` };
    case "approvals":
      return { kind: "app", path: `${base}/approvals` };
    case "tasks":
      return { kind: "app", path: `${base}/issues` };
    case "task": {
      const n = taskNumber(open.id);
      return { kind: "app", path: n ? `${base}/issues/${n}` : `${base}/issues` };
    }
    case "review": {
      const id = uuid(open.id);
      return { kind: "app", path: id ? `${base}/review/${id}` : `${base}/review` };
    }
    case "portal":
      return { kind: "app", path: `${base}/portal` };
    case "calendar":
      return { kind: "app", path: `${base}/calendar` };
    case "link": {
      const href = https(open.href);
      return href ? { kind: "outside", href } : null;
    }
  }
  return null;
}

/** The phone's route (expo-router), or an outside address; null: the phone has no such place. */
export function blockOpenPhone(open: BlockOpen): OpenTarget {
  switch (open.place) {
    case "whatsapp": {
      const account = uuid(open.id);
      const chat = account ? uuid(open.sub) : undefined;
      if (account && chat) return { kind: "app", path: "/whatsapp/chat", search: { account, chat } };
      return { kind: "app", path: account ? `/whatsapp/${account}` : "/whatsapp" };
    }
    case "proposals":
      return { kind: "app", path: "/proposals" };
    case "approvals":
      return { kind: "app", path: "/activity" };
    case "tasks":
      return { kind: "app", path: "/issues" };
    case "task": {
      const n = taskNumber(open.id);
      return { kind: "app", path: n ? `/issues/${n}` : "/issues" };
    }
    case "review": {
      const id = uuid(open.id);
      return { kind: "app", path: id ? `/review/${id}` : "/reviews" };
    }
    case "portal":
      return { kind: "app", path: "/portal" };
    case "calendar":
      return null;
    case "link": {
      const href = https(open.href);
      return href ? { kind: "outside", href } : null;
    }
  }
  return null;
}
