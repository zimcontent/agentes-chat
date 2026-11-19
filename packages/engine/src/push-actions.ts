import type { PushAction } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  type BlockView,
  type BlockViewButton,
  type BlockViewPart,
  compileBlock,
  viewBlock,
} from "@dougbot/ui/blocks/spec";
import { type ArtifactDeps, blockSpecAt } from "./artifacts";
import { drawBlock, getBlockState, setBlockState } from "./block-state";
import { replyToBlock } from "./blocks";
import { NotFoundError, ValidationError } from "./errors";
import { fileIdsOf } from "./messages";

const { artifacts, blockStates, messages, users } = schema;

/**
 * A live block's buttons on the lock screen (docs/adr/doug-0021-lock-screen.md): a push about a message whose block has
 * an `actions` part carries its first buttons as the notification's own, beside "Abrir"; a press runs the button
 * on the server as a tap in the app would (`pressBlockButton`), with the same checks.
 */

/** Buttons of a block a notification carries (iOS shows four at most, Android three, with "Abrir" beside them). */
export const PUSH_BLOCK_BUTTONS = 2;
/** A press of a block's button answers with this before the button's key. */
export const BLOCK_ACTION_PREFIX = "block:";
/** "Abrir": opens the conversation. */
export const OPEN_ACTION = "open";
/** Categories of these buttons: one per set of words (the phone registers each as the push arrives). */
export const BLOCK_CATEGORY_PREFIX = "doug.block.";

/** A button as a notification carries it: the key the press names, and its words. */
export interface NotificationButton {
  key: string;
  label: string;
}

/** Every part, depth first, the parts a row or a card holds included. */
function* partsOf(parts: readonly BlockViewPart[]): Generator<BlockViewPart> {
  for (const p of parts) {
    yield p;
    const inner = (p as { parts?: unknown }).parts;
    if (Array.isArray(inner)) yield* partsOf(inner as BlockViewPart[]);
  }
}

const doesSomething = (b: BlockViewButton) => b.say !== null || b.set !== null || b.draw !== null;

/**
 * The one mapping from a block to a notification's buttons: its first `actions` part, as it shows now, up to its
 * first `PUSH_BLOCK_BUTTONS` buttons that do something. Empty: the notification has none of its own.
 */
export function notificationButtonsOf(view: Pick<BlockView, "parts">): NotificationButton[] {
  for (const p of partsOf(view.parts)) {
    if (p.kind !== "actions") continue;
    return p.buttons
      .filter(doesSomething)
      .slice(0, PUSH_BLOCK_BUTTONS)
      .map((b) => ({ key: b.key, label: b.label }));
  }
  return [];
}

/** A block's button by its key, wherever it is, as it shows now (one hidden by its `when` is no button). */
function buttonOf(view: BlockView, key: string): BlockViewButton | null {
  for (const p of partsOf(view.parts)) {
    if (p.kind !== "actions") continue;
    const found = p.buttons.find((b) => b.key === key);
    if (found) return found;
  }
  return null;
}

/** FNV-1a, 32 bits, as hex: a short name for a set of words. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * A notification's buttons, and the category that names them: the block's buttons (each runs without opening the
 * app) then "Abrir". The same words make the same category, so the phone registers each set once.
 */
export function blockPushActions(buttons: readonly NotificationButton[], openLabel: string) {
  const actions: PushAction[] = [
    ...buttons.map((b) => ({ id: `${BLOCK_ACTION_PREFIX}${b.key}`, title: b.label, background: true })),
    { id: OPEN_ACTION, title: openLabel },
  ];
  const category = `${BLOCK_CATEGORY_PREFIX}${shortHash(JSON.stringify(actions.map((a) => [a.id, a.title])))}`;
  return { category, actions };
}

/** How a block writes numbers for a person in their language. */
const wordsFor = (locale: string | null | undefined) => {
  const tag = locale || "en";
  return { locale: tag, thousand: tag.toLowerCase().startsWith("pt") || tag.startsWith("es") ? "mil" : "k" };
};

/** A block at a version and its state now: what everyone sees of it. */
async function viewNow(deps: ArtifactDeps, orgId: string, artifactId: string, version: number, locale?: string | null) {
  const spec = await blockSpecAt(deps, orgId, artifactId, version);
  if (!spec) return null;
  const [row] = await deps.db
    .select({ state: blockStates.state })
    .from(blockStates)
    .where(and(eq(blockStates.artifactId, artifactId), eq(blockStates.version, version), eq(blockStates.orgId, orgId)));
  return viewBlock(compileBlock(spec), row?.state ?? {}, wordsFor(locale));
}

/** The block of a message with buttons a notification can carry: the first of its files that has some. */
export interface PushBlock {
  artifactId: string;
  version: number;
  buttons: NotificationButton[];
}

/**
 * The live block with buttons on a message, for its push (`deliverPush`): its files in order, the first block whose
 * buttons a notification can carry. Null: none (or the block can't be read now: the push goes without buttons).
 */
export async function pushBlockOf(
  deps: ArtifactDeps,
  orgId: string,
  messageId: string,
  locale?: string | null,
): Promise<PushBlock | null> {
  const [message] = await deps.db
    .select({ meta: messages.meta })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, messageId)));
  const ids = fileIdsOf(message?.meta);
  if (ids.length === 0) return null;
  for (const id of ids.slice(0, 5)) {
    const [a] = await deps.db
      .select({ kind: artifacts.kind, version: artifacts.currentVersion })
      .from(artifacts)
      .where(and(eq(artifacts.orgId, orgId), eq(artifacts.id, id)));
    if (a?.kind !== "block") continue;
    const view = await viewNow(deps, orgId, id, a.version, locale).catch(() => null);
    const buttons = view ? notificationButtonsOf(view) : [];
    if (buttons.length > 0) return { artifactId: id, version: a.version, buttons };
  }
  return null;
}

type PressDeps = Parameters<typeof replyToBlock>[0];

/** What a press did: the message it sent for the person, and whether it changed the block's state. */
export interface BlockPress {
  messageId: string | null;
  changed: boolean;
}

/**
 * A block's button pressed away from the block (a notification's button): the button as it shows now, run as the
 * person, through the same calls a tap in the app makes (`setBlockState`, `drawBlock`, `replyToBlock`), so the same
 * checks hold: they see the conversation, and may post there. `clientId` keeps a press that arrives twice from
 * sending its message twice.
 */
export async function pressBlockButton(
  deps: PressDeps,
  userId: string,
  orgId: string,
  artifactId: string,
  input: { version: number; key: string; clientId?: string | null },
): Promise<BlockPress> {
  // Whether the person sees the block at all, before anything of it is read.
  await getBlockState(deps, userId, orgId, artifactId, input.version);
  const [person] = await deps.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  const view = await viewNow(deps, orgId, artifactId, input.version, person?.locale);
  if (!view) throw new NotFoundError("Block not found");
  const button = buttonOf(view, input.key);
  if (!button) throw new NotFoundError("That button isn't on the block any more");
  if (!doesSomething(button)) throw new ValidationError("That button does nothing");
  let changed = false;
  if (button.set && Object.keys(button.set).length > 0) {
    await setBlockState(deps, userId, orgId, artifactId, { version: input.version, values: button.set });
    changed = true;
  }
  if (button.draw) {
    await drawBlock(deps, userId, orgId, artifactId, { version: input.version, ...button.draw });
    changed = true;
  }
  let messageId: string | null = null;
  if (button.say) {
    const sent = await replyToBlock(deps, userId, orgId, artifactId, {
      text: button.say,
      clientId: input.clientId ?? null,
    });
    messageId = sent.id;
  }
  return { messageId, changed };
}
