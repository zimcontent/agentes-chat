// DougBot: the "Doug BOSS" (the team's own chief, brought from Nordus) becomes the workspace's right hand, and the
// built-in "Lodi" goes the normal way of a deleted agent (ADR 0137 addendum 2026-11-13; ADR 0082 tombstone).
// Review before running in production; run with the server stopped or not, it uses the engine's own calls:
//   bun --env-file=../../.env scripts/doug-braco-direito.ts "<workspace name>" <chief's handle> [--dry]
// What it keeps and why (checked in packages/engine):
// - the chief's row keeps its instructions, role, model, credential, scopes, connections, memories (context_items),
//   skills and DMs: they are the row's, and only `builtin` changes;
// - as the right hand its prompt starts with the product's right-hand block and, with this fork's addendum
//   (context.ts), its own instructions follow it instead of being dropped;
// - its tools become the right hand's fixed ones (RIGHT_HAND_TOOLS / grants) while it is built in; its scopes stay
//   recorded and come back if the mark is ever moved again;
// - right_hand_brains (each person's AI for the right hand, §11) apply to it; with none for a person it thinks with
//   its own model and credential; right_hand_approvals / decisions are the workspace's and stay;
// - `agents_one_right_hand` (one per workspace): one transaction takes the mark off the old one before giving it.
import { createMemoryPubSub } from "@dougbot/adapters";
import { and, createDatabase, eq, isNull, schema } from "@dougbot/db";
import { makeRightHand, RIGHT_HAND } from "@dougbot/engine";

const [workspace = "Time Zim", handle = "doug"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const db = createDatabase({ url: process.env.DATABASE_URL ?? "", poolMax: 1 });
await db.ping();
const [org] = await db.db.select().from(schema.organizations).where(eq(schema.organizations.name, workspace));
if (!org) throw new Error(`no workspace "${workspace}"`);
const [chief] = await db.db
  .select()
  .from(schema.agents)
  .where(
    and(
      eq(schema.agents.orgId, org.id),
      eq(schema.agents.handle, handle),
      isNull(schema.agents.archivedAt),
      isNull(schema.agents.deletedAt),
    ),
  );
if (!chief) throw new Error(`no agent @${handle} in "${workspace}"`);
const [current] = await db.db
  .select({ id: schema.agents.id, name: schema.agents.name, handle: schema.agents.handle })
  .from(schema.agents)
  .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.builtin, RIGHT_HAND)));
const [owner] = await db.db
  .select({ userId: schema.organizationMembers.userId })
  .from(schema.organizationMembers)
  .where(and(eq(schema.organizationMembers.orgId, org.id), eq(schema.organizationMembers.role, "owner")));
if (!owner) throw new Error("no owner to act as");
console.log(
  JSON.stringify({ workspace: org.name, chief: `${chief.name} @${chief.handle}`, replaces: current ?? null, dry }),
);
if (!dry) {
  // A pub/sub of its own: the running apps see the change on their next read (no live event from this process).
  const old = await makeRightHand({ db: db.db, pubsub: createMemoryPubSub() }, owner.userId, org.id, chief.id);
  console.log(JSON.stringify({ done: true, rightHand: chief.id, deleted: old }));
}
await db.close();
process.exit(0);
