import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ApiError, type DougTemplateMember, type TeamTemplate } from "@agenteschat/client";
import {
  type BrandForm,
  brandFormOf,
  brandInput,
  brandReady,
  brandStillWaits,
  computerAskOf,
  computerMembers,
  computerOpens,
  countText,
  dougOf,
  flowStepAt,
  hasAgents,
  keepsComputerWanted,
  keptHandles,
  memberTree,
  newMembers,
  otherTemplates,
  phaseAfter,
  rightHandMember,
  roleLine,
  stepFailedText,
  storedComputerAsk,
  toggled,
  withBrand,
} from "../../src/features/onboarding/logic";
import { translator } from "./fixtures";

/** The Doug team's onboarding screens on the phone (docs/adr/doug-0020-time-doug.md): their pure rules. */

const member = (handle: string, over: Partial<DougTemplateMember> = {}): DougTemplateMember => ({
  handle,
  name: handle.toUpperCase(),
  role: "Papel",
  line: "Linha",
  qg: null,
  channel: null,
  reportsTo: null,
  needsComputer: false,
  rightHand: false,
  routines: 0,
  skills: 0,
  ...over,
});

const MEMBERS = [
  member("doug", { rightHand: true }),
  member("rosa"),
  member("sony", { needsComputer: true }),
  member("mark", { qg: "trafego", channel: "qg-trafego" }),
  member("copywriter", { reportsTo: "mark" }),
  member("criativo", { reportsTo: "mark", needsComputer: true }),
  member("estrategista", { reportsTo: "mark" }),
  member("solto", { reportsTo: "ninguem" }),
];

const template = (id: string, members?: DougTemplateMember[]): TeamTemplate =>
  ({ id, name: id, sub: "", description: "", team: { agents: [] }, ...(members ? { members } : {}) }) as never;

test("the Doug template is the gallery's `doug` with its members; the other models are the rest", () => {
  const gallery = [template("doug", MEMBERS), template("padaria"), template("loja")];
  expect(dougOf(gallery)?.members).toHaveLength(MEMBERS.length);
  expect(otherTemplates(gallery).map((x) => x.id)).toEqual(["padaria", "loja"]);
  // An older server (no Doug card, or one with no members) keeps the old step.
  expect(dougOf([template("padaria")])).toBeNull();
  expect(dougOf([template("doug", [])])).toBeNull();
  expect(phaseAfter("doug")).toBe("members");
  expect(phaseAfter("other")).toBe("other");
  expect(phaseAfter("scratch")).toBe("scratch");
});

test("who reports to whom: the HQ hangs from its manager, an unknown manager stays on the list", () => {
  const { top, under } = memberTree(MEMBERS);
  expect(top.map((m) => m.handle)).toEqual(["doug", "rosa", "sony", "mark", "solto"]);
  expect(under.get("mark")?.map((m) => m.handle)).toEqual(["copywriter", "criativo", "estrategista"]);
});

test("everyone starts checked, the right hand always stays, and the handles sent are the kept ones", () => {
  expect(keptHandles(MEMBERS, new Set())).toHaveLength(MEMBERS.length);
  // Unchecking the right hand does nothing: its check is fixed.
  expect(keptHandles(MEMBERS, new Set(["doug", "rosa", "criativo"]))).toEqual([
    "doug",
    "sony",
    "mark",
    "copywriter",
    "estrategista",
    "solto",
  ]);
  const unchecked = toggled(toggled(new Set(), "rosa"), "sony");
  expect([...unchecked]).toEqual(["rosa", "sony"]);
  expect([...toggled(unchecked, "rosa")]).toEqual(["sony"]);
});

test("a team of only the right hand isn't made: an agent besides it is needed", () => {
  expect(hasAgents(MEMBERS, ["doug"])).toBe(false);
  expect(hasAgents(MEMBERS, ["doug", "rosa"])).toBe(true);
});

test("the computer notice names only the kept agents that work on one", () => {
  expect(computerMembers(MEMBERS, keptHandles(MEMBERS, new Set())).map((m) => m.handle)).toEqual(["sony", "criativo"]);
  expect(computerMembers(MEMBERS, keptHandles(MEMBERS, new Set(["sony", "criativo"])))).toEqual([]);
});

test("Conectar computador opens only for an ask that has an agent on a computer the team really made", () => {
  // Asked and the team made with a computer agent: it opens.
  expect(computerOpens(true, 2)).toBe(true);
  // Not asked, whatever the team made: no.
  expect(computerOpens(false, 2)).toBe(false);
  // Asked, but the team made no computer agent (its answer came back with none, or it wasn't made at all): no.
  expect(computerOpens(true, 0)).toBe(false);
  expect(computerOpens(true, null)).toBe(false);
  expect(computerOpens(true, undefined)).toBe(false);
});

test("the ask goes on its own the moment no kept agent works on a computer", () => {
  const all = keptHandles(MEMBERS, new Set());
  expect(keepsComputerWanted(MEMBERS, all)).toBe(true);
  // Taking SONY out still leaves CRIATIVO.
  expect(keepsComputerWanted(MEMBERS, keptHandles(MEMBERS, new Set(["sony"])))).toBe(true);
  // Both out: the ask has no reason and goes.
  expect(keepsComputerWanted(MEMBERS, keptHandles(MEMBERS, new Set(["sony", "criativo"])))).toBe(false);
  // A template with no computer agent at all never has one.
  expect(keepsComputerWanted([member("a"), member("b")], ["a", "b"])).toBe(false);
});

test("the ask survives the app closing: it is kept for its workspace only, and read back as its count and its kind", () => {
  const stored = storedComputerAsk("org-1", [1, 2], false);
  expect(computerAskOf(stored, "org-1")).toEqual({ needs: 2, made: false });
  // A kept ask from a team already made says so: what opens the computer is what the team made, not the list.
  expect(computerAskOf(storedComputerAsk("org-1", [1, 2], true), "org-1")).toEqual({ needs: 2, made: true });
  // Another workspace's ask is no ask here.
  expect(computerAskOf(stored, "org-2")).toBeNull();
  // Nothing stored, or garbage, asks for nothing.
  expect(computerAskOf(null, "org-1")).toBeNull();
  expect(computerAskOf("not json", "org-1")).toBeNull();
  expect(computerAskOf("null", "org-1")).toBeNull();
  expect(computerAskOf(JSON.stringify({ orgId: "org-1" }), "org-1")).toBeNull();
  expect(computerAskOf(JSON.stringify({ orgId: "org-1", needs: "dois" }), "org-1")).toBeNull();
  expect(computerAskOf(JSON.stringify({ orgId: "org-1", needs: -1 }), "org-1")).toBeNull();
  expect(computerAskOf(JSON.stringify({ orgId: "org-1", needs: 1.5 }), "org-1")).toBeNull();
  // Made with no computer agent: the ask is zero, and zero opens nothing and says nothing.
  expect(computerAskOf(storedComputerAsk("org-1", [], true), "org-1")).toEqual({ needs: 0, made: true });
});

test("a finish refused for the brand's step still waiting is read, so `me` is read again and the brand shows", () => {
  // The server's 409 (`onboarding.brand_pending`): this flow can't go on without showing the brand.
  expect(brandStillWaits(new ApiError(409, "onboarding.brand_pending", "x"))).toBe(true);
  // Any other refusal is the screen's own message, not a step to change.
  expect(brandStillWaits(new ApiError(400, "brand.company_required", "x"))).toBe(false);
  expect(brandStillWaits(new ApiError(409, "doug_team.made", "x"))).toBe(false);
  expect(brandStillWaits(new Error("boom"))).toBe(false);
  expect(brandStillWaits(null)).toBe(false);
});

test("a lost answer after the team is made reads `me` and the agents again, so a retry sees the team and the brand", () => {
  // The hook's own refusals (`onError`) read the same two the `onSuccess` reads after the team: each is counted in the
  // hook's body, so a retry sees the team and its brand instead of pressing again into a 409.
  const flow = readFileSync(new URL("../../src/features/onboarding/doug.tsx", import.meta.url), "utf8");
  const hook = flow.slice(flow.indexOf("export function useDougTeam"), flow.indexOf("/** A round radio"));
  const meReads = [...hook.matchAll(/queryKey: keys\.me\b/g)].length;
  const agentReads = [...hook.matchAll(/queryKey: keys\.agents\(orgId\)/g)].length;
  // Once in `onSuccess`, once in `onError`.
  expect({ meReads, agentReads }).toEqual({ meReads: 2, agentReads: 2 });
  // The opening's `onboarding.brand_pending` is read before the error reaches the screen, so `me` is fresh by then.
  const parent = readFileSync(new URL("../../src/features/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
  // No failure screen either: the brand's step comes, and the flow may open again once it is saved.
  const at = parent.indexOf("if (!brandStillWaits(e)) throw e;");
  expect(at).toBeGreaterThan(0);
  const branch = parent.slice(at, at + 260);
  expect(branch).toContain("invalidateQueries({ queryKey: keys.me })");
  expect(branch).toContain("opening.current = false;");
  expect(branch).toContain("return;");
});

test("the brand's form lives above the step, so going back to the team and forward keeps what was typed", () => {
  const parent = readFileSync(new URL("../../src/features/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
  // The form is the parent's state, handed down and updated back through an updater (so two quick taps don't clash).
  expect(parent).toContain("const [brandForm, setBrandForm] = useState<BrandForm | null>(null);");
  expect(parent).toContain("form={brandForm ?? brandFormOf(null, workspace)}");
  expect(parent).toContain("setBrandForm((f) =>");
  expect(parent).toContain("seed={brandForm === null}");
  // Its own busy (a save or an upload) turns Back off: the parent reads it and answers `undefined` on Back while it is.
  expect(parent).toContain("onBusy={setBrandBusy}");
  expect(parent).toContain("pending || makeDoug.isPending || brandBusy");
});

test("each file of the manual lands in the form as it uploads, so a later one failing keeps the earlier ones", () => {
  const source = readFileSync(new URL("../../src/features/onboarding/doug.tsx", import.meta.url), "utf8");
  // The loop writes the form for each uploaded file, not once for the whole batch (an updater reads the latest).
  expect(source).toContain("onForm((f) => ({ ...f, files: [...f.files, { id: saved.id, title: saved.title }] }));");
});

test("the brand is a step right after the team while it waits, and the data's step gives way to it", () => {
  expect(withBrand(["name", "business", "team", "plan"], true)).toEqual(["name", "business", "team", "brand", "plan"]);
  expect(withBrand(["name", "business", "team"], true)).toEqual(["name", "business", "team", "brand"]);
  expect(withBrand(["name", "business", "team"], false)).toEqual(["name", "business", "team"]);
  // The team exists (the data reaches the plan, or the opening) and the brand waits: the brand shows.
  expect(flowStepAt({ step: "plan", at: "plan", brandPending: true, picked: null })).toBe("brand");
  expect(flowStepAt({ step: "team", at: "open", brandPending: true, picked: null })).toBe("brand");
  // Back to the team (a done step) shows the team; with no brand pending nothing changes.
  expect(flowStepAt({ step: "team", at: "plan", brandPending: true, picked: "team" })).toBe("team");
  expect(flowStepAt({ step: "plan", at: "plan", brandPending: false, picked: null })).toBe("plan");
  // The team not made yet: its own step stays, whatever the workspace says.
  expect(flowStepAt({ step: "team", at: "team", brandPending: true, picked: null })).toBe("team");
});

const FORM: BrandForm = {
  company: " Padaria Aurora ",
  tones: [],
  tone: "",
  site: "",
  instagram: "",
  audience: "",
  files: [],
  link: "",
};

test("the brand needs a company and a tone, tapped or written", () => {
  expect(brandReady(FORM)).toBe(false);
  expect(brandReady({ ...FORM, tones: ["proximo"] })).toBe(true);
  expect(brandReady({ ...FORM, tone: "  caloroso " })).toBe(true);
  expect(brandReady({ ...FORM, tone: "   " })).toBe(false);
  expect(brandReady({ ...FORM, company: "  ", tones: ["proximo"] })).toBe(false);
});

test("the brand goes as what was filled in, trimmed, the files by id and the link as a list", () => {
  expect(brandInput({ ...FORM, tones: ["proximo", "direto"] })).toEqual({
    company: "Padaria Aurora",
    tones: ["proximo", "direto"],
  });
  expect(
    brandInput({
      ...FORM,
      tone: " sem jargão ",
      site: "padariaaurora.com.br",
      instagram: "@padariaaurora",
      audience: "  moradores do bairro ",
      files: [{ id: "f1", title: "manual.pdf" }],
      link: " https://example.com/manual ",
    }),
  ).toEqual({
    company: "Padaria Aurora",
    tone: "sem jargão",
    site: "padariaaurora.com.br",
    instagram: "@padariaaurora",
    audience: "moradores do bairro",
    files: ["f1"],
    links: ["https://example.com/manual"],
  });
});

test("the form starts from the saved brand, else from the workspace's name", () => {
  expect(brandFormOf(null, "Café Sol")).toMatchObject({ company: "Café Sol", tones: [], link: "" });
  expect(
    brandFormOf(
      {
        company: "Café Sol",
        tones: ["proximo"],
        tone: null,
        site: "cafesol.com",
        instagram: null,
        audience: null,
        files: [{ id: "f1", title: "manual.pdf" }],
        links: ["https://example.com/m"],
      },
      "outro",
    ),
  ).toEqual({
    company: "Café Sol",
    tones: ["proximo"],
    tone: "",
    site: "cafesol.com",
    instagram: "",
    audience: "",
    files: [{ id: "f1", title: "manual.pdf" }],
    link: "https://example.com/m",
  });
});

test("the API's refusals read in the person's language", async () => {
  const pt = await translator("pt-BR");
  const en = await translator("en");
  const refuse = (code: string) => new ApiError(400, code, "x");
  expect(stepFailedText(pt, refuse("brand.company_required"), "pt-BR")).toBe("Diga o nome da empresa.");
  expect(stepFailedText(en, refuse("brand.tone_required"), "en")).toBe(
    "Pick a tone of voice or write it in your own words.",
  );
  expect(stepFailedText(pt, new ApiError(409, "doug_team.made", "x"), "pt-BR")).toContain("Time Doug");
  expect(stepFailedText(pt, new ApiError(409, "onboarding.brand_pending", "x"), "pt-BR")).toContain("marca");
  // What isn't listed says only that it didn't save.
  expect(stepFailedText(pt, new Error("boom"), "pt-BR")).toBe(pt("mobile.onb.failed"));
});

test("the screens' words exist, with their plurals, in both languages", async () => {
  const pt = await translator("pt-BR");
  const en = await translator("en");
  expect(pt("mobile.dougOnb.howTitle")).toBe("Como você quer começar o time?");
  expect(pt("mobile.dougOnb.membersTitle")).toBe("Quem entra no seu time?");
  expect(pt("mobile.dougOnb.brandTitle")).toBe("Ensine a sua marca ao time");
  expect(pt("mobile.dougOnb.recommended")).toBe("Recomendado");
  expect(pt("mobile.dougOnb.count", { count: 1 })).toBe("1 agente");
  expect(pt("mobile.dougOnb.count", { count: 17 })).toBe("17 agentes");
  expect(en("mobile.dougOnb.count", { count: 1 })).toBe("1 agent");
  expect(en("mobile.dougOnb.more", { n: 6 })).toBe("+6 more in the HQ");
});

test("the count says the new agents and the Doug apart: it already exists and is never counted as new", async () => {
  const pt = await translator("pt-BR");
  const en = await translator("en");
  const adding = newMembers(MEMBERS, keptHandles(MEMBERS, new Set()));
  // Eight members, the DOUG among them: seven agents join, the right hand is named, not counted.
  expect(adding.map((m) => m.handle)).toEqual([
    "rosa",
    "sony",
    "mark",
    "copywriter",
    "criativo",
    "estrategista",
    "solto",
  ]);
  expect(rightHandMember(MEMBERS)?.name).toBe("DOUG");
  const count = countText(pt, adding.length, "DOUG");
  expect(count).toBe("7 agentes novos + o DOUG");
  expect(en("mobile.dougOnb.countNew", { count: 1, name: "DOUG" })).toBe("1 new agent + DOUG");
  // One: the singular form, not "1 agentes".
  expect(pt("mobile.dougOnb.countNew", { count: 1, name: "DOUG" })).toBe("1 agente novo + o DOUG");
  // A template that names no right hand counts alone, as before.
  expect(countText(pt, 3, null)).toBe("3 agentes");
  expect(rightHandMember([member("a"), member("b")])).toBeNull();
});

test("a role shows only when it says more than the name: a Copywriter named for its role says it once", () => {
  expect(roleLine({ name: "ROSA", role: "Diretora de arte" })).toBe("Diretora de arte");
  expect(roleLine({ name: "Copywriter", role: "Copywriter" })).toBeNull();
  // Case and the outside spaces don't make a difference two: the same words twice are still the same words.
  expect(roleLine({ name: "Estrategista", role: " estrategista " })).toBeNull();
  // The right hand's fixed check is its own tag row now, not a third "·" on the role's (a dense chain).
  const source = readFileSync(new URL("../../src/features/onboarding/doug.tsx", import.meta.url), "utf8");
  expect(source).toContain("{m.rightHand && !small ? (");
  expect(source).toContain('t("mobile.dougOnb.fixed")');
  // No three-part "·" chain in a row's line: the role then the fixed mark, in one string.
  expect(source).not.toMatch(/m\.role\} · /);
  expect(source).not.toMatch(/· \$\{t\(/);
});

test("on the phone, announcing a count and a failure is a function of iOS only: nothing fires on Android", () => {
  // The screen reads `Platform.OS` and calls `AccessibilityInfo.announceForAccessibility` where it is "ios"; the rule
  // the test can hold without a renderer is that the source asks the platform before it speaks.
  const source = readFileSync(new URL("../../src/features/onboarding/doug.tsx", import.meta.url), "utf8");
  expect(source).toContain('if (Platform.OS !== "ios") return;');
  expect(source).toContain("AccessibilityInfo.announceForAccessibility(count)");
  expect(source).toContain("AccessibilityInfo.announceForAccessibility(failed)");
});

test("small buttons and lines reach a finger's 44: the row's more, the file's remove, the text buttons", () => {
  // The kit's small button is 32 and its target grows past it (`slopOf`); a text button has no plate, so it sits in a
  // 44-point row (`skipRow`). What the screen draws without the kit (`more`, the file's remove) carries its own slop.
  const source = readFileSync(new URL("../../src/features/onboarding/doug.tsx", import.meta.url), "utf8");
  expect(source).toContain("hitSlop={8}"); // "Ver mais/menos", a 32-point line
  expect(source).toContain("hitSlop={12}"); // the manual's remove, a 16-point icon
  expect(source).toContain("skipRow: { minHeight: 44");
});

test("these two screens' own style sheets hold to the review's rules: no boxShadow, no absolute, no unguarded global", () => {
  // Only the two files of this change are read: what a row draws through the kit (`AgentAvatar`, `AuthField`,
  // `OptionTile`, `Button`) is the kit's, with its own plate and shadow, and this test says nothing about it.
  const files = ["doug.tsx", "logic.ts"];
  for (const name of files) {
    const source = readFileSync(new URL(`../../src/features/onboarding/${name}`, import.meta.url), "utf8");
    expect({ name, boxShadow: /boxShadow/.test(source) }).toEqual({ name, boxShadow: false });
    // Hermes has no `crypto`, `TextEncoder`, `TextDecoder`, `Buffer` or `structuredClone` of its own.
    expect({ name, globals: /\b(crypto|TextEncoder|TextDecoder|Buffer|structuredClone)\b/.test(source) }).toEqual({
      name,
      globals: false,
    });
    // One column draws the rows and their spacing: nothing is placed absolutely over another piece.
    expect({ name, absolute: /position:\s*"absolute"/.test(source) }).toEqual({ name, absolute: false });
  }
});
