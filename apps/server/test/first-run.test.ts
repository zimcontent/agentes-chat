import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

/* The right hand's first run over HTTP (ADR 0155 §6): the checklist it starts with, a stored skip, a template's team in one call. */

let t: TestServer;
afterEach(() => t.close());

interface AgentRow {
  id: string;
  handle: string;
  builtin: string | null;
  setup: { role: string | null; done: string[] } | null;
}

test("a new workspace's right hand starts the checklist; only Agora não is stored; Criar o time makes the team at once", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const created = (await (await owner("/api/app/organizations", { json: { name: "Acme" } })).json()) as {
    organization: { id: string };
  };
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${created.organization.id}${path}`, init);
  const list = async () => ((await (await api("/agents")).json()) as { agents: AgentRow[] }).agents;

  const [lodi] = await list();
  expect(lodi).toMatchObject({ builtin: "right_hand", setup: { role: null, done: [] } });

  const skipped = await api(`/agents/${lodi?.id}/setup/apps`, { json: {} });
  expect(skipped.status).toBe(200);
  expect(((await skipped.json()) as AgentRow).setup?.done).toEqual(["apps"]);
  // The other rows read done from the data: nothing to store.
  expect((await api(`/agents/${lodi?.id}/setup/about`, { json: {} })).status).toBe(404);

  const used = await api("/team-templates/clinic/use", { json: { locale: "pt-BR" } });
  expect(used.status).toBe(200);
  const card = (await used.json()) as { channelId: string; state: string; error: unknown };
  expect(card).toMatchObject({ state: "created", error: null });
  expect((await list()).filter((a) => !a.builtin).length).toBeGreaterThan(1);

  // One message in the DM, the created card: no question after it.
  const messages = (await (await api(`/channels/${card.channelId}/messages`)).json()) as {
    messages: { meta: Record<string, unknown> | null }[];
  };
  expect(messages.messages.length).toBe(1);
  expect(messages.messages.some((m) => m.meta?.replyChips)).toBe(false);
});

test("a personal workspace (ADR 0159): made with its mode, its templates are for one person's life, made with no channel", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "solo@example.com");
  const made = await owner("/api/app/organizations", { json: { name: "Personal", mode: "personal" } });
  const created = (await made.json()) as { organization: { id: string } };
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${created.organization.id}${path}`, init);
  expect(((await (await api("/settings")).json()) as { mode: string }).mode).toBe("personal");

  const gallery = (await (await api("/team-templates?locale=en")).json()) as {
    templates: { id: string; team: { agents: { channel: string }[]; newChannels: string[] } }[];
  };
  // The areas of a personal workspace, and no Doug team: an app asks for it apart (docs/adr/doug-0030-time-doug.md).
  expect(gallery.templates.map((x) => x.id)).toEqual(["life", "health", "studies", "home", "travel", "freelance"]);
  const personal = gallery.templates;
  expect(personal.every((x) => x.team.newChannels.length === 0)).toBe(true);
  expect(personal.flatMap((x) => x.team.agents.map((a) => a.channel))).not.toContain("support");

  const used = await api("/team-templates/life/use", { json: { locale: "en" } });
  expect(used.status).toBe(200);
  expect(await used.json()).toMatchObject({ state: "created", error: null });
  const agents = ((await (await api("/agents")).json()) as { agents: AgentRow[] }).agents;
  expect(agents.filter((a) => !a.builtin).map((a) => a.handle)).toEqual(expect.arrayContaining(["clara", "duda"]));
});

test("the Doug team over HTTP (docs/adr/doug-0030-time-doug.md): the chosen agents, the brand step, then done", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "doug@example.com");
  const created = (await (await owner("/api/app/organizations", { json: { name: "Acme" } })).json()) as {
    organization: { id: string };
  };
  const orgId = created.organization.id;
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  const me = async () =>
    (
      (await (await owner("/api/app/me")).json()) as {
        organizations: { id: string; onboarding?: { brandPending?: boolean } }[];
      }
    ).organizations.find((o) => o.id === orgId);

  // The gallery holds business types only; the Doug team comes apart, to an app that asks (`?with=doug`), with every
  // agent listed, the right hand among them and marked as such.
  const gallery = (await (await api("/team-templates?locale=pt-BR")).json()) as {
    templates: { id: string }[];
    doug?: { id: string; members: { handle: string; qg: string | null; rightHand: boolean }[] };
  };
  expect(gallery.templates.map((t) => t.id)).not.toContain("doug");
  expect(gallery.doug).toBeUndefined();
  const withDoug = (await (await api("/team-templates?with=doug&locale=pt-BR")).json()) as typeof gallery;
  const doug = withDoug.doug;
  expect(doug?.id).toBe("doug");
  expect(doug?.members.length).toBe(17);
  expect(doug?.members.find((m) => m.handle === "doug")?.rightHand).toBe(true);
  expect(doug?.members.find((m) => m.handle === "rosa")?.qg).toBe("design");
  // The business types still come with it.
  expect(withDoug.templates.map((t) => t.id)).not.toContain("doug");

  const used = await api("/team-templates/doug/use", { json: { handles: ["doug", "rosa"], locale: "pt-BR" } });
  expect(used.status).toBe(200);
  const card = (await used.json()) as { state: string; brandPending?: boolean; needsComputer: { handle: string }[] };
  expect(card.state).toBe("created");
  expect(card.brandPending).toBe(true);
  expect(card.needsComputer.map((c) => c.handle)).toEqual(["rosa"]);
  // Once: a second click is refused.
  const again = await api("/team-templates/doug/use", { json: {} });
  expect(again.status).toBe(409);
  expect(((await again.json()) as { error: { code: string } }).error.code).toBe("doug_team.made");

  // The brand step: pending, the tones in the person's language. An app that draws the step asks to be held by it
  // (`holdBrand`); one that knows nothing of it finishes (docs/adr/doug-0030-time-doug.md).
  expect((await me())?.onboarding?.brandPending).toBe(true);
  const brand = (await (await api("/brand?locale=pt-BR")).json()) as {
    pending: boolean;
    tones: { id: string; label: string }[];
  };
  expect(brand.pending).toBe(true);
  expect(brand.tones).toHaveLength(10);
  expect(brand.tones[0]?.label).toBe("Próximo");
  const finished = await api("/onboarding", { method: "PATCH", json: { finished: true, holdBrand: true } });
  expect(finished.status).toBe(409);
  expect(((await finished.json()) as { error: { code: string } }).error.code).toBe("onboarding.brand_pending");
  const noTone = await api("/brand", { method: "PUT", json: { company: "Acme" } });
  expect(noTone.status).toBe(400);
  expect(((await noTone.json()) as { error: { code: string } }).error.code).toBe("brand.tone_required");
  const saved = await api("/brand", {
    method: "PUT",
    json: { company: "Acme", tones: ["direto"], site: "acme.com.br", instagram: "@acme" },
  });
  expect(saved.status).toBe(200);
  const said = (await saved.json()) as {
    skillId: string;
    pending: boolean;
    brand: { site: string; instagram: string };
  };
  expect(said.pending).toBe(false);
  expect(said.brand).toMatchObject({ site: "https://acme.com.br/", instagram: "@acme" });
  // Read back with what was said; the step no longer waits.
  const read = (await (await api("/brand")).json()) as { pending: boolean; brand: { company: string } | null };
  expect(read).toMatchObject({ pending: false, brand: { company: "Acme" } });
  expect((await me())?.onboarding?.brandPending).toBeUndefined();
  expect((await api("/onboarding", { method: "PATCH", json: { finished: true } })).status).toBe(200);
});

test("an app that knows nothing of the brand step finishes the onboarding; the brand is still asked for in the DM", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "old-app@example.com");
  const created = (await (await owner("/api/app/organizations", { json: { name: "Acme" } })).json()) as {
    organization: { id: string };
  };
  const orgId = created.organization.id;
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  expect((await api("/team-templates/doug/use", { json: { handles: ["rosa"], locale: "pt-BR" } })).status).toBe(200);
  // The old app sends no `holdBrand`: the onboarding ends, and the brand is left for the DM to ask (still pending).
  expect((await api("/onboarding", { method: "PATCH", json: { finished: true } })).status).toBe(200);
  const me = (await (await owner("/api/app/me")).json()) as {
    organizations: { id: string; onboarding?: { brandPending?: boolean } }[];
  };
  expect(me.organizations.find((o) => o.id === orgId)?.onboarding).toBeUndefined();
  // Done, the step no longer "waits" (`pending` means the onboarding still awaits it); the brand is still saved by the
  // same route, and the DOUG asks for it in the DM.
  expect((await (await api("/brand")).json()) as { pending: boolean; brand: unknown }).toMatchObject({
    pending: false,
    brand: null,
  });
  const saved = await api("/brand", { method: "PUT", json: { company: "Acme", tones: ["direto"] } });
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as { pending: boolean }).pending).toBe(false);
});
