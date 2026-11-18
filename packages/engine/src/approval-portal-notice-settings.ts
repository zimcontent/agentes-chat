import type { Database } from "@agenteschat/db";
import { and, eq, schema } from "@agenteschat/db";
import { NotFoundError } from "./errors";

const { organizationSettings, whatsappAccounts } = schema;

/**
 * The workspace's choice of which of its WhatsApp numbers the approval portal's notices go out as (docs/adr/
 * doug-0020-embedded-approval-portal.md §7): the number's id, one of `whatsapp_accounts`; null is none, and then
 * nothing goes by WhatsApp, whatever other numbers the workspace has. A client is never texted from a person's own
 * number, or from the number an agent happens to answer on, unless the workspace picked that one here.
 */
export interface PortalNoticeSettings {
  /** The number that tells the portal's clients, or null: by e-mail alone. */
  number: string | null;
  /** Every connected number of the workspace, for the picker. */
  numbers: { id: string; label: string; phone: string | null }[];
}

/** The connected numbers of the workspace the portal's notices may go as, and which one is chosen. */
export async function portalNoticeSettingsOf(db: Database, orgId: string): Promise<PortalNoticeSettings> {
  const [choice] = await db
    .select({ id: organizationSettings.portalNoticeNumber })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  const numbers = await db
    .select({ id: whatsappAccounts.id, label: whatsappAccounts.label, phone: whatsappAccounts.phone })
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.status, "connected")));
  const chosen = numbers.find((n) => n.id === choice?.id)?.id ?? null;
  return { number: chosen, numbers };
}

/**
 * Sets the number the portal's notices go out as, or clears it (`number` null): the route checks who may (`assign_work`)
 * before it calls here. A number that isn't one of the workspace's connected ones is refused, so a client is never
 * texted from a number the team can't see or use.
 */
export async function setPortalNoticeNumber(db: Database, orgId: string, number: string | null) {
  if (number) {
    const [row] = await db
      .select({ id: whatsappAccounts.id })
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.orgId, orgId),
          eq(whatsappAccounts.id, number),
          eq(whatsappAccounts.status, "connected"),
        ),
      );
    if (!row) throw new NotFoundError("That number isn't a connected one of this workspace", "whatsapp.number_not_found");
  }
  await db
    .insert(organizationSettings)
    .values({ orgId, portalNoticeNumber: number })
    .onConflictDoUpdate({ target: organizationSettings.orgId, set: { portalNoticeNumber: number, updatedAt: new Date() } });
}
