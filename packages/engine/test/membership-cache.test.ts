import { afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import {
  can,
  changeMemberRole,
  createRole,
  deleteRole,
  enableCaches,
  getMembership,
  removeMember,
  setMemberRoles,
  setUserBlocked,
  TtlCache,
} from "../src";
import { addMember, addUser, type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
  enableCaches();
});
afterEach(async () => {
  enableCaches(false);
  await f.close();
});

const mayManage = async (userId: string) => {
  const m = await getMembership(f.db, userId, f.org.id);
  return m ? can(m, "manage_members") : null;
};
const roleOf = async (userId: string) => (await getMembership(f.db, userId, f.org.id))?.role ?? null;
const writeRole = (userId: string, role: "owner" | "member") =>
  f.db
    .update(schema.organizationMembers)
    .set({ role })
    .where(and(eq(schema.organizationMembers.orgId, f.org.id), eq(schema.organizationMembers.userId, userId)));

test("a cached membership follows a role change and a block at once", async () => {
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  expect(await roleOf(bia.id)).toBe("member");

  await changeMemberRole(f.db, f.owner.id, f.org.id, bia.id, "owner");
  expect(await roleOf(bia.id)).toBe("owner");
  // Cached: a write that skips the engine's writers goes unseen until the entry expires.
  await writeRole(bia.id, "member");
  expect(await roleOf(bia.id)).toBe("owner");

  await setUserBlocked({ db: f.db, pubsub: f.pubsub }, bia.id, { blocked: true, reason: null });
  expect(await roleOf(bia.id)).toBeNull();
});

test("no membership is never kept: someone who just joined is let in at once", async () => {
  const caio = await addUser(f.db, "caio");
  expect(await roleOf(caio.id)).toBeNull();
  await f.db.insert(schema.organizationMembers).values({ orgId: f.org.id, userId: caio.id, role: "member" });
  expect(await roleOf(caio.id)).toBe("member");
});

test("a membership read that an invalidation overtook is returned but not kept", async () => {
  const cache = new TtlCache<string>(5_000);
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  const load = cache.getOrLoad("org:bia", async () => {
    await held;
    return "member";
  });
  cache.delete("org:bia");
  release();
  expect(await load).toBe("member");
  expect(cache.get("org:bia")).toBeUndefined();
});

test("a read inside a transaction that rolls back is not kept", async () => {
  const caio = await addUser(f.db, "caio");
  await f.db
    .transaction(async (tx) => {
      await tx.insert(schema.organizationMembers).values({ orgId: f.org.id, userId: caio.id, role: "member" });
      expect((await getMembership(tx, caio.id, f.org.id))?.role).toBe("member");
      tx.rollback();
    })
    .catch(() => {});
  expect(await roleOf(caio.id)).toBeNull();
});

test("a cached membership is gone at once when the person is removed or loses a role", async () => {
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  const role = await createRole(f.db, f.owner.id, f.org.id, { name: "Editors", permissions: ["manage_members"] });
  await setMemberRoles(f.db, f.owner.id, f.org.id, bia.id, [role.id]);
  expect(await mayManage(bia.id)).toBe(true);

  await setMemberRoles(f.db, f.owner.id, f.org.id, bia.id, []);
  expect(await mayManage(bia.id)).toBe(false);

  await setMemberRoles(f.db, f.owner.id, f.org.id, bia.id, [role.id]);
  expect(await mayManage(bia.id)).toBe(true);
  await deleteRole(f.db, f.owner.id, f.org.id, role.id);
  expect(await mayManage(bia.id)).toBe(false);

  await removeMember(f.db, f.owner.id, f.org.id, bia.id);
  expect(await getMembership(f.db, bia.id, f.org.id)).toBeNull();
});
