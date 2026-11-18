import { and, type Database, eq, schema } from "@agenteschat/db";
import { recordAudit } from "./audit";
import { ValidationError } from "./errors";

const { portalClientSettings } = schema;

/*
 * How the team knows each of the approval portal's clients on this side (ADR 9001, addendum 2026-11-18). The portal
 * names a client by its slug and has no call to rename, create or delete one, so the name the team shows and whether
 * the team still wants the client in its lists are kept here, per workspace and client, on the row that already says
 * what an approval means for it (`portal_client_settings`). A hidden client leaves every list and count of the apps;
 * nothing at the portal changes, and showing it again brings everything back as it was.
 */

/** The longest name the team may give a client. */
export const PORTAL_CLIENT_NAME_MAX = 60;

export interface PortalClientNaming {
  /** The team's name for each client that has one. */
  names: Map<string, string>;
  /** The clients the team hid. */
  hidden: Set<string>;
}

export async function portalClientNaming(db: Database, orgId: string): Promise<PortalClientNaming> {
  const rows = await db
    .select({
      client: portalClientSettings.client,
      name: portalClientSettings.displayName,
      hiddenAt: portalClientSettings.hiddenAt,
    })
    .from(portalClientSettings)
    .where(eq(portalClientSettings.orgId, orgId));
  const names = new Map<string, string>();
  const hidden = new Set<string>();
  for (const row of rows) {
    if (row.name) names.set(row.client, row.name);
    if (row.hiddenAt) hidden.add(row.client);
  }
  return { names, hidden };
}

/** The name a person typed, tidied: one line, spaces collapsed; empty is no name (back to the slug's). */
export function portalClientNameOf(input: string | null): string | null {
  const name = (input ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (name.length > PORTAL_CLIENT_NAME_MAX) {
    throw new ValidationError(`A client's name has at most ${PORTAL_CLIENT_NAME_MAX} characters`);
  }
  return name;
}

async function settingFor(db: Database, orgId: string, client: string) {
  const [row] = await db
    .select({ name: portalClientSettings.displayName, hiddenAt: portalClientSettings.hiddenAt })
    .from(portalClientSettings)
    .where(and(eq(portalClientSettings.orgId, orgId), eq(portalClientSettings.client, client)));
  return row ?? null;
}

/** Gives a client the name the team shows (`null`: back to its slug's), audited. Answers the name kept. */
export async function setPortalClientName(
  db: Database,
  orgId: string,
  client: string,
  input: string | null,
  userId: string,
): Promise<string | null> {
  const name = portalClientNameOf(input);
  const before = (await settingFor(db, orgId, client))?.name ?? null;
  if (before === name) return name;
  await db
    .insert(portalClientSettings)
    .values({ orgId, client, displayName: name, updatedBy: userId })
    .onConflictDoUpdate({
      target: [portalClientSettings.orgId, portalClientSettings.client],
      set: { displayName: name, updatedBy: userId, updatedAt: new Date() },
    });
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "portal.client_renamed",
    target: { type: "portal_client", id: client },
    details: { client, from: before, to: name },
  });
  return name;
}

/** Hides a client from every list of the apps, or shows it again, audited. Nothing changes at the portal. */
export async function setPortalClientHidden(
  db: Database,
  orgId: string,
  client: string,
  hidden: boolean,
  userId: string,
): Promise<void> {
  const was = Boolean((await settingFor(db, orgId, client))?.hiddenAt);
  if (was === hidden) return;
  const hiddenAt = hidden ? new Date() : null;
  await db
    .insert(portalClientSettings)
    .values({ orgId, client, hiddenAt, updatedBy: userId })
    .onConflictDoUpdate({
      target: [portalClientSettings.orgId, portalClientSettings.client],
      set: { hiddenAt, updatedBy: userId, updatedAt: new Date() },
    });
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: hidden ? "portal.client_hidden" : "portal.client_shown",
    target: { type: "portal_client", id: client },
    details: { client },
  });
}
