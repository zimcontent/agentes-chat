import { describe, expect, test } from "bun:test";
import {
  afterAgent,
  afterPerson,
  bringIn,
  CONTINUE_MS,
  giveFloor,
  initialFloor,
  interrupt,
  namedAgent,
} from "../src/lib/live-floor";

/** Who has the word in a voice room (ADR doug-0006): names and the small model pick, the limits keep it from running away. */

const ana = { id: "ana", name: "Ana Souza", handle: "ana" };
const bruno = { id: "bruno", name: "Bruno", handle: "dev-bruno" };
const doug = { id: "doug", name: "Doug BOSS", handle: "doug" };
const agents = [ana, bruno, doug];

describe("names", () => {
  test("the first agent named, by first name, full name or handle, accents and case aside", () => {
    expect(namedAgent("Ána, o que você acha?", agents)).toBe("ana");
    expect(namedAgent("e aí, dev bruno?", agents)).toBe("bruno");
    expect(namedAgent("Bruno, depois a Ana fala", agents)).toBe("bruno");
    expect(namedAgent("doug boss, fecha a pauta", agents)).toBe("doug");
  });
  test("whole words only, and never the speaker itself", () => {
    expect(namedAgent("a banana está madura", agents)).toBeNull();
    expect(namedAgent("Ana, concordo", agents, "ana")).toBeNull();
  });
});

describe("a person speaks", () => {
  test("a name gives that agent the word", () => {
    const d = afterPerson(initialFloor(), "Bruno, quanto tempo leva?", { agents, people: 2, now: 1000 });
    expect(d).toMatchObject({ changed: true, reason: "named", ask: false, state: { holder: "bruno" } });
  });
  test("one person and one agent: the agent answers everything", () => {
    const d = afterPerson(initialFloor(), "e o prazo?", { agents: [ana], people: 1, now: 0 });
    expect(d.state.holder).toBe("ana");
  });
  test("the agent that just spoke keeps the word for the answer, for a while", () => {
    const spoke = afterAgent(initialFloor("ana"), "ana", "Qual o orçamento?", { agents, now: 10_000 }).state;
    expect(afterPerson(spoke, "uns dez mil", { agents, people: 2, now: 15_000 }).state.holder).toBe("ana");
    const late = afterPerson(spoke, "pessoal, vamos almoçar?", { agents, people: 2, now: 10_000 + CONTINUE_MS + 1 });
    expect(late).toMatchObject({ state: { holder: null }, ask: true });
  });
});

describe("a call that just started", () => {
  test("one person: the agent that greets keeps the word for their first words", () => {
    const d = afterPerson(initialFloor("ana", 0), "oi", { agents, people: 1, now: 60_000 });
    expect(d).toMatchObject({ state: { holder: "ana" }, ask: false });
  });
  test("one person and nobody with the word: the small model is asked who answers", () => {
    expect(afterPerson(initialFloor(), "oi, tudo bem?", { agents, people: 1, now: 0 })).toMatchObject({
      state: { holder: null },
      ask: true,
    });
  });
  test("several people: the agent just given the word keeps it a while even before it spoke", () => {
    const given = giveFloor(initialFloor(), "bruno", "judge", 1000).state;
    expect(afterPerson(given, "e aí?", { agents, people: 2, now: 5000 }).state.holder).toBe("bruno");
    expect(afterPerson(given, "e aí?", { agents, people: 2, now: 1000 + CONTINUE_MS + 1 }).state.holder).toBeNull();
  });
});

describe("agents among themselves: lively, never a loop", () => {
  test("a colleague named gets the word; past the turns in a row, the people have it", () => {
    let s = afterPerson(initialFloor(), "Ana, comece", { agents, people: 2, now: 0 }).state;
    const turn = (who: string, text: string, next?: string) => {
      const d = afterAgent(s, who, text, { agents, now: 1 }, next);
      s = d.state;
      return d;
    };
    expect(turn("ana", "Bruno, como você faria?")).toMatchObject({ reason: "handoff", state: { holder: "bruno" } });
    expect(turn("bruno", "Doug, você aprova?")).toMatchObject({ reason: "handoff", state: { holder: "doug" } });
    expect(turn("doug", "Ana, refaça os números")).toMatchObject({ reason: "handoff", state: { holder: "ana" } });
    expect(turn("ana", "Feito.", "bruno")).toMatchObject({ reason: "handoff", state: { holder: "bruno" } });
    expect(turn("bruno", "Doug?")).toMatchObject({ reason: "handoff", state: { holder: "doug" } });
    // The sixth agent turn in a row: back to the people, whoever it names.
    expect(turn("doug", "Ana, de novo")).toMatchObject({ reason: "limit", state: { holder: null } });
  });
  test("one agent takes at most two turns in a stretch: back and forth once, never a duet", () => {
    let s = initialFloor("ana");
    s = afterAgent(s, "ana", "Bruno?", { agents, now: 1 }).state;
    s = afterAgent(s, "bruno", "Ana, e você?", { agents, now: 2 }).state;
    expect(s.holder).toBe("ana");
    s = afterAgent(s, "ana", "Bruno, concorda?", { agents, now: 3 }).state;
    expect(s.holder).toBe("bruno");
    // Ana spoke twice: Bruno can't hand it back to her.
    const d = afterAgent(s, "bruno", "Ana, mais uma?", { agents, now: 4 });
    expect(d).toMatchObject({ reason: "limit", state: { holder: null } });
  });
  test("the small model's pick follows an agent that named nobody", () => {
    const d = afterAgent(initialFloor("ana"), "ana", "Acho que dá pra lançar em março.", { agents, now: 1 }, "doug");
    expect(d).toMatchObject({ reason: "handoff", state: { holder: "doug", chain: 1, spoke: ["ana"] } });
  });
  test("a colleague picked to follow an agent that finished, within the limits", () => {
    const s = afterAgent(initialFloor("ana"), "ana", "Proponho março.", { agents, now: 1 }).state;
    expect(bringIn(s, "bruno", 2)).toMatchObject({ reason: "handoff", state: { holder: "bruno", chain: 1 } });
    expect(bringIn(s, "ana", 2)).toBeNull();
    expect(bringIn({ ...s, chain: 5 }, "bruno", 2)).toBeNull();
  });
  test("jumping in: the one talking is cut off and its turn counts; the limits hold", () => {
    const d = interrupt(initialFloor("ana"), "bruno", 5);
    expect(d).toMatchObject({
      reason: "interrupt",
      changed: true,
      state: { holder: "bruno", chain: 1, spoke: ["ana"] },
    });
    expect(interrupt(initialFloor("ana"), "ana", 5)).toBeNull();
    expect(interrupt(initialFloor(null), "ana", 5)).toBeNull();
    const tired = { ...initialFloor("ana"), spoke: ["bruno", "ana", "bruno"] };
    expect(interrupt(tired, "bruno", 5)).toBeNull();
  });
  test("a person speaking starts the count again", () => {
    const s = afterAgent(initialFloor("ana"), "ana", "Bruno?", { agents, now: 1 }).state;
    const after = afterPerson(s, "Ana, explica melhor", { agents, people: 2, now: 2 }).state;
    expect(after).toMatchObject({ chain: 0, spoke: [], holder: "ana" });
  });
  test("given by hand or by the judge", () => {
    expect(giveFloor(initialFloor(), "doug", "manual")).toMatchObject({ changed: true, state: { holder: "doug" } });
    expect(giveFloor(initialFloor("doug"), null, "manual").state.holder).toBeNull();
  });
});
