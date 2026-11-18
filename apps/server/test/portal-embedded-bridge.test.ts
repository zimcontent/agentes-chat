import { afterEach, expect, test } from "bun:test";
import { createFakeApprovalPortal } from "@agenteschat/adapters";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

// An installation with a bridge of its own (`APPROVAL_PORTAL_URL` + `APPROVAL_PORTAL_TOKEN`) keeps everything it had
// before the installation's own portal existed (docs/adr/doug-0022-embedded-approval-portal.md): the portal it reaches
// is the bridge's, and none of the client-managing routes or the client's own page come with it. This test is the
// promise that turning the embedded one on changes nothing for the installation that already has a bridge.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

async function start() {
  // A bridge's portal: the fake answers the same contract, and `approvalPortalEmbedded` is left off, as `start.ts`
  // leaves it when the env vars are set.
  const portal = createFakeApprovalPortal();
  t = await createTestServer({ approvalPortal: portal, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}`;
  const api = (path: string, init?: Parameters<typeof owner>[1]) => owner(`${base}${path}`, init);
  return { owner, orgId, api, portal };
}

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

test("a bridge's installation: the client routes answer portal.off, and no client's page is mounted", async () => {
  const { api } = await start();
  expect((await api("/portal-clients")).status).toBe(404);
  expect(await code(await api("/portal-clients"))).toBe("portal.off");
  // The client's own page is the embedded portal's: a bridge's has its own, elsewhere.
  expect((await t.app.request("/p/api/any-token-that-holds-twenty-characters")).status).toBe(404);
});

test("a bridge's installation keeps its board and its send: the tools and the routes the portal always had", async () => {
  const { api, portal } = await start();
  const card = await portal.createCard("acme", { title: "Reel de dezembro" });
  const board = await api("/portal/clients/acme");
  expect(board.status).toBe(200);
  expect(((await board.json()) as { cards: { todo: { id: string }[] } }).cards.todo.map((c) => c.id)).toContain(card.id);
  // The overview still reads the bridge's portal.
  expect((await api("/portal")).status).toBe(200);
});
