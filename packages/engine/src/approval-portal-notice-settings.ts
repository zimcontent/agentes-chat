import type { Database } from "@dougbot/db";
import { and, eq, schema } from "@dougbot/db";
import { NotFoundError } from "./errors";
import { can, getMembership } from "./organizations";

const { organizationSettings, whatsappAccounts } = schema;

/**
 * The workspace's choice of which of its WhatsApp numbers the approval portal's notices go out as (docs/adr/
 * doug-0031-embedded-approval-portal.md §8): the number's id, one of `whatsapp_accounts`; null is none, and then
 * nothing goes by WhatsApp, whatever other numbers the workspace has. A client is never texted from a person's own
 * number, or from the number an agent happens to answer on, unless the workspace picked that one here.
 *
 * Who sees and picks a number: the people on its list (`whatsapp_accounts.people`, the same list that lets someone
 * read and answer its conversations), and whoever manages connectors (`manage_connectors`), to whom every connected
 * number of the workspace is offered. Anyone else is offered none and picks none: a number they may not use is not
 * theirs to hand the portal.
 */
export interface PortalNoticeSettings {
  /** The number chosen, when the actor may still use it; null: by e-mail alone, or a choice no longer the actor's. */
  number: string | null;
  /** The numbers the actor may pick from, for the picker. */
  numbers: { id: string; label: string; phone: string | null }[];
}

/** Who is asking: the person, and whether they manage connectors (and so see every number of the workspace). */
export interface PortalNoticeActor {
  userId: string;
  manages: boolean;
}

/** The actor as the routes read them: a membership with `manage_connectors` sees every number. */
export async function portalNoticeActorOf(db: Database, userId: string, orgId: string): Promise<PortalNoticeActor> {
  const membership = await getMembership(db, userId, orgId);
  return { userId, manages: membership ? can(membership, "manage_connectors") : false };
}

/** A number the actor may use: on its `people` list, or every one for someone who manages connectors. */
const usableBy = (actor: PortalNoticeActor) => (row: { people: string[] }) =>
  actor.manages || row.people.includes(actor.userId);

/**
 * The connected numbers the actor may offer the portal, and which one is chosen. A choice whose number the actor may
 * no longer use (`chosenNumber` in portal-notices.ts makes the same test for what goes out) is read as none here, so
 * the picker never shows a number the person behind it can't send from.
 */
export async function portalNoticeSettingsOf(
  db: Database,
  orgId: string,
  actor: PortalNoticeActor,
): Promise<PortalNoticeSettings> {
  const rows = await db
    .select({
      id: whatsappAccounts.id,
      label: whatsappAccounts.label,
      phone: whatsappAccounts.phone,
      people: whatsappAccounts.people,
    })
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.status, "connected")));
  const usable = usableBy(actor);
  const numbers = rows.filter(usable).map(({ people: _people, ...number }) => number);
  const [choice] = await db
    .select({ id: organizationSettings.portalNoticeNumber })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  const chosen = numbers.find((n) => n.id === choice?.id)?.id ?? null;
  return { number: chosen, numbers };
}

/**
 * Sets the number the portal's notices go out as, or clears it (`number` null): the route checks who may (`assign_work`)
 * before it calls here. A number that isn't one of the workspace's connected ones, or that the actor may not use
 * (neither on its `people` list nor seen through `manage_connectors`), is refused, so a client is never texted from a
 * number the team can't see or use.
 */
export async function setPortalNoticeNumber(
  db: Database,
  orgId: string,
  number: string | null,
  actor: PortalNoticeActor,
) {
  if (number) {
    const [row] = await db
      .select({ id: whatsappAccounts.id, people: whatsappAccounts.people })
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.orgId, orgId),
          eq(whatsappAccounts.id, number),
          eq(whatsappAccounts.status, "connected"),
        ),
      );
    if (!row || !usableBy(actor)(row)) {
      throw new NotFoundError("That number isn't a connected one you may use", "whatsapp.number_not_found");
    }
  }
  await db
    .insert(organizationSettings)
    .values({ orgId, portalNoticeNumber: number, portalNoticeNumberBy: actor.userId })
    .onConflictDoUpdate({
      target: organizationSettings.orgId,
      set: { portalNoticeNumber: number, portalNoticeNumberBy: actor.userId, updatedAt: new Date() },
    });
}
