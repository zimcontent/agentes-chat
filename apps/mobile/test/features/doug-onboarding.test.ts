import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ApiError, type DougTemplateMember, type TeamTemplate } from "@agenteschat/client";
import {
  type BrandForm,
  brandFormOf,
  brandInput,
  brandReady,
  computerMembers,
  dougOf,
  flowStepAt,
  hasAgents,
  keptHandles,
  memberTree,
  otherTemplates,
  phaseAfter,
  stepFailedText,
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

test("the screens keep the iPhone's hard rules: no shadow on a repeated row, no global Hermes may lack", () => {
  const dir = new URL("../../src/features/onboarding/", import.meta.url);
  const source = readFileSync(new URL("doug.tsx", dir), "utf8");
  expect(source).not.toMatch(/boxShadow/);
  // Hermes has no `crypto`, `TextEncoder` or `Buffer` of its own.
  expect(source).not.toMatch(/\b(crypto|TextEncoder|TextDecoder|Buffer|structuredClone)\b/);
  // One list draws the rows and their spacing: nothing is placed absolutely over another piece.
  expect(source).not.toMatch(/position:\s*"absolute"/);
});
