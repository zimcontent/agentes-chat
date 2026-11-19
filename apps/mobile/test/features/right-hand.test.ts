import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DirectMessage } from "@dougbot/client";
import { canTalk } from "@dougbot/client/lib/audience";
import {
  firstVisitOf,
  introCards,
  introLeadKey,
  offersTeamSetup,
  RIGHT_HAND_DEFAULT,
  rightHandOf,
  teamAnswered,
  tellsNameStory,
  welcomeOpen,
  welcomesMember,
} from "@dougbot/client/lib/right-hand";
import { STICKER_STILL_T, WAVE_SECONDS } from "@dougbot/ui/agent/stickers";
import { stickerFrame } from "../../src/agent/sticker";
import { agentStarters, buildConversations, homeLayout, withRightHand } from "../../src/features/chats/logic";
import { SETTINGS_SECTIONS } from "../../src/features/settings/logic";
import { agent, at } from "./fixtures";

const lodi = agent({ id: "a-lodi", name: "Lodi", builtin: "right_hand" });
const theo = agent({ id: "a-theo", name: "Theo" });
const dm = (a: { id: string; name: string; handle: string }, minutesAgo: number, unread = 0): DirectMessage => ({
  channelId: `d-${a.id}`,
  with: { type: "agent", id: a.id, name: a.name, handle: a.handle },
  lastMessage: { id: `m-${a.id}`, body: "Oi", createdAt: at(minutesAgo), authorType: "agent" },
  unread,
});

test("the right hand is one of Agentes' rows, by its latest message like any agent (doug-0014)", () => {
  const rows = buildConversations({ channels: [], dms: [dm(lodi, 5, 2), dm(theo, 1)], threads: [] });
  const all = withRightHand(rows, rightHandOf([theo, lodi]));
  const agents = homeLayout(all, []).find((s) => s.key === "agents");
  // Theo wrote last: first. The right hand keeps its unread.
  expect(agents?.rows.map((r) => r.key)).toEqual(["d:d-a-theo", "d:d-a-lodi"]);
  expect(agents?.rows[1]).toMatchObject({ unread: 2 });
});

test("Início has no field of its own for the right hand: no greeting, no box, its DM in the list", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/features/${f}`, import.meta.url), "utf8");
  const chats = src("chats/ChatsScreen.tsx");
  expect(chats).not.toContain("RightHandAsk");
  expect(chats).not.toContain("<Greeting");
  expect(chats).toContain("withRightHand(list.rows, rightHand && canTalk(rightHand) ? rightHand : undefined)");
});

test("with no DM yet its row starts one, at the end; with no agent DM at all, every agent is a starter", () => {
  const rows = buildConversations({ channels: [], dms: [dm(theo, 1)], threads: [] });
  expect(withRightHand(rows, lodi).map((r) => r.key)).toEqual(["d:d-a-theo", "a:a-lodi"]);
  expect(withRightHand([], lodi)).toEqual([]);
  const starters = agentStarters([lodi, theo]);
  expect(starters.map((r) => r.key)).toEqual(["a:a-lodi", "a:a-theo"]);
});

test("outside its audience it isn't added", () => {
  const hidden = { ...lodi, canTalk: false };
  expect(canTalk(hidden)).toBe(false);
  const rows = buildConversations({ channels: [], dms: [dm(theo, 1)], threads: [] });
  expect(withRightHand(rows, canTalk(hidden) ? hidden : undefined)).toEqual(rows);
});

test("the way to build the team: with a team, no card left and no open checklist, for who may create agents", () => {
  const base = { noAi: false, aiKnown: true, createsAgents: true, hasTeam: true, cards: [] };
  expect(offersTeamSetup(base)).toBe(true);
  // A card still asks, or there is no team to build again: the card or the interview is the way.
  expect(offersTeamSetup({ ...base, cards: ["style"] })).toBe(false);
  expect(offersTeamSetup({ ...base, hasTeam: false })).toBe(false);
  expect(offersTeamSetup({ ...base, noAi: true })).toBe(false);
  expect(offersTeamSetup({ ...base, aiKnown: false })).toBe(false);
  expect(offersTeamSetup({ ...base, createsAgents: false })).toBe(false);
  // Under the owner's checklist (ADR 0155 §6): only once it is complete.
  expect(offersTeamSetup({ ...base, checklist: "open" })).toBe(false);
  expect(offersTeamSetup({ ...base, checklist: "complete" })).toBe(true);
});

test("on a billing hold its greeting offers no line to build the team: that message would be refused", () => {
  const s = { noAi: false, aiKnown: true, createsAgents: true, hasTeam: true, cards: [] };
  expect(offersTeamSetup(s)).toBe(true);
  expect(offersTeamSetup({ ...s, held: true })).toBe(false);
});

test("its greeting's cards beside the checklist: one question at a time (ADR 0155 §6)", () => {
  const base = { noAi: false, aiKnown: true, askStyle: true };
  // The owner's open checklist holds the whole setup: nothing else asks, Connect included.
  expect(introCards({ ...base, noAi: true, checklist: "open" })).toEqual([]);
  expect(introCards({ ...base, checklist: "open" })).toEqual([]);
  // Complete: how agents talk to them, until they pick (ADR 0147); never a second Connect.
  expect(introCards({ ...base, checklist: "complete" })).toEqual(["style"]);
  expect(introCards({ ...base, noAi: true, checklist: "complete" })).toEqual(["style"]);
  // Anyone without the checklist (an invited person): Connect AI first, then the question.
  expect(introCards({ ...base, noAi: true, checklist: "none" })).toEqual(["connect"]);
  expect(introCards({ ...base, noAi: true, noAiCard: true })).toEqual([]);
  expect(introCards(base)).toEqual(["style"]);
  expect(introCards({ ...base, askStyle: false })).toEqual([]);
  expect(introCards({ ...base, aiKnown: false })).toEqual([]);
  // On a billing hold an AI comes after the plan, a saved key reading ready changes nothing: no card asks.
  expect(introCards({ ...base, noAi: true, held: true })).toEqual([]);
  expect(introCards({ ...base, held: true })).toEqual([]);
  // On a hold the greeting says how the team comes only while there is none; then what it does, on web and phone.
  expect(introLeadKey(true, false)).toBe("rightHand.intro.heldLead");
  expect(introLeadKey(true, true)).toBe("rightHand.intro.lead");
  expect(introLeadKey(false, false)).toBe("rightHand.intro.lead");
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  // A personal workspace reads its own sibling (ADR 0159), on both.
  for (const f of ["../../src/features/right-hand/Intro.tsx", "../../../web/src/components/RightHandIntro.tsx"])
    expect(src(f)).toContain("t(modeKey(org, introLeadKey(held, team.length > 0)))");
});

test("how agents should talk waits for the team's first answer, so it never stands beside the first task", () => {
  const base = { noAi: false, aiKnown: true, askStyle: true, checklist: "complete" as const };
  expect(introCards({ ...base, answered: false })).toEqual([]);
  expect(introCards({ ...base, answered: true })).toEqual(["style"]);
  const iara = agent({ id: "a-iara", name: "Iara" });
  const status = (agentId: string, activeAt: string | null) => ({ agentId, activeAt });
  // The team made, nobody of it worked yet (the right hand's own runs don't count): it waits.
  expect(teamAnswered([iara], [status("a-iara", null), status("a-lodi", at(0))])).toBe(false);
  expect(teamAnswered([iara], undefined)).toBe(false);
  // Iara answered the first task.
  expect(teamAnswered([iara], [status("a-iara", at(0))])).toBe(true);
  // No team: no first task to wait for.
  expect(teamAnswered([], undefined)).toBe(true);
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  for (const f of ["../../src/features/right-hand/Intro.tsx", "../../../web/src/components/RightHandIntro.tsx"])
    expect(src(f)).toContain("answered: useTeamAnswered(");
});

test("someone it greeted when they joined is asked one thing: Connect alone above its stored greeting", () => {
  expect(welcomesMember({ bodyCode: "welcome_member", bodyParams: { org: "Acme" } })).toBe(true);
  expect(welcomesMember({ bodyCode: "team_week" })).toBe(false);
  expect(welcomesMember(null)).toBe(false);
  const base = { noAi: false, aiKnown: true, askStyle: true, welcomed: true };
  // How agents talk to them would be a second question beside what they look after.
  expect(introCards(base)).toEqual([]);
  expect(introCards({ ...base, welcomed: false })).toEqual(["style"]);
  // With no AI the way to connect one stays, until a no-AI card in the conversation carries it.
  expect(introCards({ ...base, noAi: true })).toEqual(["connect"]);
  expect(introCards({ ...base, noAi: true, noAiCard: true })).toEqual([]);
  expect(introCards({ ...base, noAi: true, held: true })).toEqual([]);
  // Nor the line to build the team: the greeting already offers their first agent.
  const again = { noAi: false, aiKnown: true, createsAgents: true, hasTeam: true, cards: [] };
  expect(offersTeamSetup(again)).toBe(true);
  expect(offersTeamSetup({ ...again, welcomed: true })).toBe(false);
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  for (const f of ["../../src/features/right-hand/Intro.tsx", "../../../web/src/components/RightHandIntro.tsx"]) {
    expect(src(f)).toMatch(/const welcomed = welcomeOpen\(messages, org\??\.role === "owner"\);/);
    expect(src(f)).toMatch(/introCards\(\{[^}]*\bwelcomed\b[^}]*\}\)/);
    expect(src(f)).toMatch(/offersTeamSetup\(\{[^}]*\bwelcomed\b[^}]*\}\)/);
  }
});

test("its greeting of a newcomer is the one ask only until they answer it, whatever page it is on", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  const line = (id: string, n: number, type: "agent" | "person", meta: Record<string, unknown> = {}) => ({
    id,
    createdAt: at(n),
    author: { type, id: type },
    body: id,
    meta,
  });
  const greeting = line("greeting", 1, "agent", { bodyCode: "welcome_member" });
  expect(welcomeOpen([greeting], false)).toBe(true);
  // What it says after by itself is no answer.
  expect(welcomeOpen([greeting, line("card", 2, "agent", { bodyCode: "team_day" })], false)).toBe(true);
  // Answered: the top of its DM asks what it asks anyone, also while that message is still sending.
  expect(welcomeOpen([greeting, line("vendas", 2, "person")], false)).toBe(false);
  expect(welcomeOpen([greeting, { ...line("vendas", 2, "person"), local: "pending" as const }], false)).toBe(false);
  expect(welcomeOpen([greeting, { ...line("vendas", 2, "person"), local: "failed" as const }], false)).toBe(true);
  // A long conversation: the greeting left the loaded page, and the answer is the same as with it loaded.
  const page = Array.from({ length: 100 }, (_, i) => line(`m${i}`, 10 + i, i % 2 ? "agent" : "person"));
  expect(welcomeOpen(page, false)).toBe(false);
  expect(welcomeOpen([greeting, line("vendas", 2, "person"), ...page], false)).toBe(false);
  // Never greeted, and an empty conversation.
  expect(welcomeOpen([line("oi", 1, "person")], false)).toBe(false);
  expect(welcomeOpen([], false)).toBe(false);
  // Still loading: nothing shows and then leaves for someone it may have greeted. An owner never is, so theirs
  // doesn't wait.
  expect(welcomeOpen(undefined, false)).toBe(true);
  expect(welcomeOpen(undefined, true)).toBe(false);
});

test("the right hand's conversation draws the checklist; Início shows who waits on your reply instead (doug-0014)", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/features/${f}`, import.meta.url), "utf8");
  expect(src("right-hand/Intro.tsx")).toContain("<FirstRunCard agent={agent} channelId={channelId} />");
  expect(src("chats/ChatsScreen.tsx")).toContain("<HomeWaiting ");
  // The apps row names what it reads, as the web's does, never "Sem apps" with apps connected; an invitation waiting
  // finishes the people row, saying who; a personal workspace's rows read its own words (ADR 0159).
  const card = src("right-hand/FirstRun.tsx");
  expect(card).toContain("apps: appNames,");
  expect(card).toContain("invited: run.invited.length ? joinNames(run.invited, t) : null,");
  // As on the web: the AI row connects the whole team, the apps row is its own screen of suggested apps, a skip says
  // nothing, and an invitation only sent says so, the welcome kept for someone joining (ADR 0162).
  expect(card).toContain("openConnectAi(team.length > 0 ? {} : { agentId: agent.id })");
  expect(card).toContain('apps: () => openSetupStep(agent.id, "apps")');
  expect(card).toContain("firstRunBeats(doneHere, { members: run.members, invited: run.invited.length })");
  expect(card).toContain('? t("agentSetup.firstRun.say.invited")');
  expect(card).toContain(
    ": firstRunFact(facts, beat)\n          ? t(firstRunSayKey(beat, personal), agentGrammar(agent.name))",
  );
  // One first task, the team card's: the card's asks offer none.
  expect(card).not.toContain("firstTask");
  const steps = src("agents/setup/SetupStepScreen.tsx");
  expect(steps).toContain("firstRun ? <FirstRunAppsStep /> : <AppsStep agent={agent} />");
  expect(steps).toContain("firstRunAppList(");
  expect(steps).toContain('router.push({ pathname: "/connectors", params: { connect: def.id } })');
});

test("on a hold for its first plan the phone's card leads with the plan row: where to choose it, in words only", () => {
  const card = readFileSync(new URL("../../src/features/right-hand/FirstRun.tsx", import.meta.url), "utf8");
  // The row comes only while the workspace waits for its first plan (ADR 0162, amended 2026-11-10).
  expect(card).toContain('waitsForPlan: hold === "payment",');
  expect(card).toContain('plan: "play",');
  // No button and no way to pay from the phone (App Store 3.1.1): its line says where the plan is chosen, or who can.
  expect(card).toContain("plan: () => undefined,");
  expect(card).toContain('...(words.action && s !== "plan" && !(s === "about" && next === "about")');
  expect(card).toContain('b: t(mayPay ? "connectAi.billingWeb" : "standing.billing.askAdmin"),');
  // Any other hold has no plan row: the AI row says it, as before.
  expect(card).toContain('const holdLine = s === "ai" && state === "afterPlan" && !steps.includes("plan");');
  for (const banned of ["billingLink", "BillingLink", "planOffer", "plans.json"]) expect(card).not.toContain(banned);
});

test("its Computador row is always there: it opens the viewer's own place, or says why it has none", () => {
  const screen = readFileSync(new URL("../../src/features/right-hand/SettingsScreen.tsx", import.meta.url), "utf8");
  expect(screen).toContain("      <Computer agentId={agent.id} />\n");
  expect(screen).toContain("const none = rightHandNoComputer(view.desktopQ.data?.reason);");
  // With none there is nothing to open: no chevron, no press, and the reason under the row.
  expect(screen).toContain('<GroupedRow icon="laptop" label={t("agentComputer.button")} />');
  expect(screen).toContain('<GroupedFooter>{t(none ?? "rightHand.computerYours")}</GroupedFooter>');
  // No computer of the workspace's own: whoever may add one opens Dispositivos from the row.
  expect(screen).toContain('const add = none === "rightHand.computerNoHome" && can(org, "pair_computers");');
  expect(screen).toContain('onPress={() => router.push("/settings/devices")}');
});

test("Configurações lists no section for it: its settings open from its own profile, on their screen", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/features/${f}`, import.meta.url), "utf8");
  expect(SETTINGS_SECTIONS.map((s) => s.id as string)).not.toContain("right_hand");
  expect(src("right-hand/SettingsScreen.tsx")).toContain('router.push("/settings/right-hand" as never)');
  expect(src("agents/AgentProfileScreen.tsx")).toContain("rightHand ? openRightHandSettings() : openAgentSettings(id)");
});

test("its DM, cards and profile treat it apart through the one shared helper", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/features/${f}`, import.meta.url), "utf8");
  // No computer in its DM, and its own line; its field says "Mensagem para …" on one line, as every DM's.
  const chat = src("chat/ChatScreen.tsx");
  expect(chat).toContain("isRightHand(dmAgent)");
  expect(chat).not.toContain('t("rightHand.composerHint")');
  expect(chat).toMatch(/dmComputer = dmAgentId && !isThread && !rightHand/);
  // Its profile's Ajustes are its own settings (its AI is each person's there), and it answers to no agent.
  const profile = src("agents/AgentProfileScreen.tsx");
  expect(profile).toContain("rightHand || !teamAgent");
  // No coordinator anywhere on the phone (ADR 0093, superseded by 0137).
  for (const f of [
    "agents/AgentSettingsScreen.tsx",
    "agents/edit.ts",
    "agents/AgentProfileScreen.tsx",
    "chat/ChannelMembers.tsx",
  ])
    expect(src(f)).not.toMatch(/coordinator/i);
});

test("it waves on the person's first visit only: its DM never read by them, on any device", () => {
  expect(firstVisitOf(undefined, lodi.id)).toBeUndefined();
  expect(firstVisitOf([dm(theo, 1)], lodi.id)).toBeUndefined();
  expect(firstVisitOf([{ ...dm(lodi, 1), everRead: false }], lodi.id)).toBe(true);
  expect(firstVisitOf([{ ...dm(lodi, 1), everRead: true }], lodi.id)).toBe(false);
  // An older server says nothing: no wave.
  expect(firstVisitOf([dm(lodi, 1)], lodi.id)).toBe(false);
  // Decided by the conversation, so the greeting moving into the list with the first message keeps it, not playing
  // again; under the greeting, decorative, playing once.
  const chat = readFileSync(new URL("../../src/features/chat/ChatScreen.tsx", import.meta.url), "utf8");
  expect(chat).toContain('useRightHandWave(orgId, rightHand && dmAgent ? dmAgent.id : "")');
  expect(
    chat.match(/<RightHandIntro agent=\{dmAgent\} channelId=\{channelId\} waveFrom=\{waveFrom\} \/>/g),
  ).toHaveLength(2);
  const intro = readFileSync(new URL("../../src/features/right-hand/Intro.tsx", import.meta.url), "utf8");
  expect(intro).toMatch(/mood="wave"[\s\S]*playFor=\{WAVE_SECONDS\}[\s\S]*from=\{waveFrom\}/);
  expect(intro).toContain('importantForAccessibility="no-hide-descendants"');
});

test("its wave moves, then ends on its still frame, so stopping shows no jump", () => {
  const look = { color: "teal", eyes: "happy", accessory: "headset" };
  const still = JSON.stringify(stickerFrame(look, "wave", 110, STICKER_STILL_T));
  expect(JSON.stringify(stickerFrame(look, "wave", 110, 0.1))).not.toBe(still);
  expect(JSON.stringify(stickerFrame(look, "wave", 110, WAVE_SECONDS))).toBe(still);
});

test("its profile tells where its name comes from only while it keeps it, and only for the right hand", () => {
  // The right hand's default name is the fork's (Doug), read from the one place that keeps it.
  const named = { ...lodi, name: RIGHT_HAND_DEFAULT.name };
  expect(tellsNameStory(named)).toBe(true);
  expect(tellsNameStory({ ...named, name: "Tuca" })).toBe(false);
  expect(tellsNameStory(agent({ id: "a-other", name: RIGHT_HAND_DEFAULT.name }))).toBe(false);
  expect(tellsNameStory(undefined)).toBe(false);
});
