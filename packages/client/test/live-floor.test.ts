import { describe, expect, test } from "bun:test";
import { afterAgent, afterPerson, CONTINUE_MS, giveFloor, initialFloor, namedAgent } from "../src/lib/live-floor";

/** Who has the word in a voice room (ADR doug-0006): names decide, and agents can't keep handing it around. */

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

describe("agents among themselves never loop", () => {
  test("a colleague named gets the word, up to the limit; then the people have it", () => {
    let s = afterPerson(initialFloor(), "Ana, comece", { agents, people: 2, now: 0 }).state;
    let d = afterAgent(s, "ana", "Bruno, como você faria?", { agents, now: 1 });
    expect(d).toMatchObject({ reason: "handoff", state: { holder: "bruno", chain: 1 } });
    s = d.state;
    d = afterAgent(s, "bruno", "Doug, você aprova?", { agents, now: 2 });
    expect(d).toMatchObject({ reason: "handoff", state: { holder: "doug", chain: 2 } });
    s = d.state;
    // Third agent turn in a row: back to the people, whoever it names.
    d = afterAgent(s, "doug", "Ana, refaça os números", { agents, now: 3 });
    expect(d).toMatchObject({ reason: "limit", state: { holder: null } });
  });
  test("handing the word back to who already spoke is refused", () => {
    const s = afterAgent(initialFloor("ana"), "ana", "Bruno?", { agents, now: 1 }).state;
    const d = afterAgent(s, "bruno", "Ana, sua vez de novo", { agents, now: 2 });
    expect(d.state.holder).toBe("bruno");
    expect(d.reason).toBe("continue");
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
