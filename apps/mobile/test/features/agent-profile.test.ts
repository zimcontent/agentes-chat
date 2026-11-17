import { describe, expect, test } from "bun:test";
import type { AgentAccess, AgentForYouItem, Memory, OrgSummary, PlanUsage } from "@agenteschat/client";
import { listsAgent, mailLossText, widenQuestion } from "@agenteschat/client/lib/audience";
import { planMeterText } from "@agenteschat/client/lib/plan-usage";
import { planLine } from "@agenteschat/ui/plan-state";
import { monthShare, TEAM_ORDER, teamNowOf, todayRows } from "../../src/features/agents/lite";
import {
  byPlaybook,
  canEditMemories,
  type DidLine,
  dayWord,
  didLines,
  knownAboutMe,
  memoryOrigin,
  plainRole,
  usesOf,
  type WorkItem,
} from "../../src/features/agents/logic";
import { agent, translator } from "./fixtures";

const NOW = new Date(2026, 9, 17, 15, 0);
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const work = (agentId: string, since: string): WorkItem => ({
  key: `r:${agentId}`,
  agentId,
  kind: "run",
  what: "pesquisando os preços",
  channelId: "c1",
  threadId: null,
  where: { kind: "channel", name: "produto" },
  missionId: null,
  plan: null,
  since,
  waiting: false,
});

describe("Perfil: a função numa frase", () => {
  test("skips the prompt's self-introduction and keeps what follows the comma", () => {
    expect(plainRole("Você é o Theo, desenvolvedor do Time Lumen. Cuida do repositório.")).toBe(
      "Desenvolvedor do Time Lumen",
    );
    expect(plainRole("Você é a Nina.\nPesquisa mercado e concorrentes. Responda em português.")).toBe(
      "Pesquisa mercado e concorrentes",
    );
    expect(plainRole("You are Iris")).toBeNull();
  });

  test("what someone typed when creating it, plain, upper case first, short", () => {
    expect(plainRole("responder clientes no **e-mail** e me avisar quando algo for urgente")).toBe(
      "Responder clientes no e-mail e me avisar quando algo for urgente",
    );
    const long = plainRole(`cuida ${"de muitas coisas diferentes ".repeat(10)}`) ?? "";
    expect(long.length).toBeLessThanOrEqual(91);
    expect(long.endsWith("…")).toBe(true);
    expect(plainRole("")).toBeNull();
    expect(plainRole(undefined)).toBeNull();
  });
});

describe("Perfil: memórias", () => {
  const mem = (over: Partial<Memory> & { id: string }): Memory => ({
    agentId: "theo",
    kind: "preference",
    text: "Prefere publicar correções depois das 18h",
    source: "",
    uses: 0,
    lastUsedAt: null,
    pinned: false,
    archived: false,
    lowTrust: false,
    verified: true,
    supersedes: null,
    editedByUserId: null,
    updatedAt: ago(1),
    ...over,
  });

  test("only the agent's owner or who reviews memory may change them", () => {
    const theo = { ownerUserId: "u1" };
    const member = { permissions: ["read", "post"] };
    const reviewer = { permissions: ["read", "review_memory"] };
    expect(canEditMemories(theo, { id: "u1", org: member })).toBe(true);
    expect(canEditMemories(theo, { id: "u2", org: reviewer })).toBe(true);
    expect(canEditMemories(theo, { id: "u2", org: member })).toBe(false);
    expect(canEditMemories(theo, { id: "u2", org: undefined })).toBe(false);
    expect(canEditMemories({ ownerUserId: null }, { id: "u2", org: member })).toBe(false);
    expect(canEditMemories(theo, { id: null, org: reviewer })).toBe(false);
  });

  test("where it came from: said in your DM, in a channel, written by you, or learned", () => {
    const at = ago(2);
    expect(
      memoryOrigin(mem({ id: "1", from: { messageId: "m", channelId: "d", threadId: null, dm: true, at } }), "u1"),
    ).toEqual({ kind: "saidDm", at });
    expect(
      memoryOrigin(
        mem({
          id: "2",
          origin: { by: "agent", name: null, channel: "produto", at: ago(30) },
          from: { messageId: "m", channelId: "c", threadId: null, dm: false, at },
        }),
        "u1",
      ),
    ).toEqual({ kind: "saidChannel", channel: "produto", at });
    expect(
      memoryOrigin(
        mem({ id: "3", editedByUserId: "u1", origin: { by: "person", name: "W", channel: null, at } }),
        "u1",
      ),
    ).toEqual({ kind: "wrote", at });
    expect(memoryOrigin(mem({ id: "4", origin: { by: "agent", name: null, channel: null, at } }), "u1")).toEqual({
      kind: "learned",
      at,
    });
  });

  test("active ones, pinned first, then the newest", () => {
    const list = knownAboutMe([
      mem({ id: "old", updatedAt: ago(30) }),
      mem({ id: "gone", archived: true }),
      mem({ id: "new", updatedAt: ago(1) }),
      mem({ id: "pin", pinned: true, updatedAt: ago(90) }),
    ]);
    expect(list.map((m) => m.id)).toEqual(["pin", "new", "old"]);
    expect(knownAboutMe(undefined)).toEqual([]);
  });

  test("its playbook apart from what matters to people, in the same order", () => {
    const { people, playbook } = byPlaybook([
      mem({ id: "pref" }),
      mem({ id: "howto", playbook: true }),
      mem({ id: "fact", playbook: false }),
      mem({ id: "lesson", playbook: true }),
    ]);
    expect(people.map((m) => m.id)).toEqual(["pref", "fact"]);
    expect(playbook.map((m) => m.id)).toEqual(["howto", "lesson"]);
  });

  test("today, yesterday or the date", () => {
    expect(dayWord(ago(1), NOW)).toEqual({ kind: "today" });
    expect(dayWord(ago(24), NOW)).toEqual({ kind: "yesterday" });
    expect(dayWord(ago(24 * 5), NOW)).toEqual({ kind: "date", iso: ago(24 * 5) });
  });
});

describe("Perfil: o que fez por você", () => {
  const action = (kind: string, target: Record<string, unknown>, params: Record<string, unknown> = {}) =>
    ({
      type: "action",
      at: ago(1),
      channelId: "c1",
      action: {
        id: `x-${kind}`,
        kind,
        agentId: "theo",
        messageId: "m1",
        requestedByUserId: "u1",
        target,
        params,
        createdAt: ago(1),
        undoableUntil: ago(0.9),
        undoneAt: null,
        undoneByUserId: null,
        redoneAt: null,
      },
    }) as AgentForYouItem;

  test("receipts in the third person, files and approvals, each opening its place", () => {
    const lines = didLines([
      action("issue.created", { type: "issue", id: "i1", number: 131, title: "Login no Safari 15" }),
      action("memory.saved", { type: "memory", id: "k1" }, { text: "x" }),
      action("thread.closed", { type: "thread", id: "t1", title: "Erro" }),
      {
        type: "file",
        at: ago(2),
        file: { id: "f1", kind: "document", title: "Erros da semana", channelId: "c1", threadId: null },
      },
      {
        type: "approval",
        at: ago(0.1),
        approval: {
          id: "a1",
          title: "Merge PR #128",
          status: "pending",
          channelId: "c1",
          threadId: "t1",
          waitingOnYou: true,
        },
      },
      {
        type: "approval",
        at: ago(3),
        approval: {
          id: "a2",
          title: "Deploy",
          status: "refused",
          channelId: "c1",
          threadId: "t1",
          waitingOnYou: false,
        },
      },
    ]);
    expect(lines.map((l) => [l.title.key, l.title.values, l.sub, l.href, l.waiting])).toEqual([
      ["action.issueCreated", { number: "131" }, { text: "Login no Safari 15" }, { kind: "issue", number: 131 }, false],
      ["action.threadClosed", { title: "Erro" }, null, { kind: "chat", channelId: "c1", threadId: "t1" }, false],
      ["file", { title: "Erros da semana" }, { key: "fileKind.document" }, { kind: "file", id: "f1" }, false],
      ["approval", { title: "Merge PR #128" }, { key: "waitingOnYou" }, { kind: "approval", id: "a1" }, true],
      ["approval", { title: "Deploy" }, { key: "youRefused" }, { kind: "approval", id: "a2" }, false],
    ]);
    expect(didLines(undefined)).toEqual([]);
  });
});

describe("Perfil: o que pode usar", () => {
  const tool = (scope: string, state: string, sensitive = false) => ({
    name: scope,
    label: scope,
    description: "",
    readOnly: scope.endsWith("read"),
    connectionId: "c1",
    scope,
    sensitive,
    state,
  });

  test("apps and areas with their level in plain words; whether an action still asks", () => {
    const access = {
      all: false,
      builtins: [
        { scope: "drive:read", label: "Ler o Drive", state: "granted", tools: [tool("drive:read", "granted")] },
        { scope: "drive:write", label: "Escrever", state: "granted", tools: [tool("drive:write", "granted")] },
        { scope: "issues:read", label: "Ler issues", state: "off", tools: [tool("issues:read", "off")] },
      ],
      connectors: [
        {
          connectionId: "c1",
          connector: "github",
          label: "GitHub",
          custom: false,
          state: "granted",
          scopes: [
            { scope: "github:repo.read", label: "Ler", state: "granted", tools: [tool("github:repo.read", "granted")] },
            {
              scope: "github:pr.merge",
              label: "Merge",
              state: "granted",
              tools: [tool("github:pr.merge", "granted", true)],
            },
          ],
        },
        {
          connectionId: "c2",
          connector: "sentry",
          label: "Sentry",
          custom: false,
          state: "off",
          scopes: [
            {
              scope: "sentry:issues.read",
              label: "Ler",
              state: "granted",
              tools: [tool("sentry:issues.read", "granted")],
            },
            { scope: "sentry:issues.write", label: "Mudar", state: "off", tools: [tool("sentry:issues.write", "off")] },
          ],
        },
      ],
    } as unknown as AgentAccess;
    const { lines, asks } = usesOf(access);
    expect(lines.map((l) => [l.label, l.level])).toEqual([
      [{ text: "GitHub" }, "write"],
      [{ text: "Sentry" }, "read"],
      [{ area: "drive" }, "write"],
    ]);
    expect(asks).toBe(true);
    expect(usesOf(null)).toEqual({ lines: [], asks: false });
  });
});

describe("Perfil: o mês, com os limites do plano (ADR 0063 §5)", () => {
  const usage = (windows: PlanUsage["windows"]): PlanUsage => ({ windows, source: "probe", at: NOW.toISOString() });

  test("the compact line in the plan's words, tightest first; near the limit, when it renews; nothing unknown", async () => {
    const pt = planMeterText(await translator("pt-BR"), "pt-BR", NOW);
    const en = planMeterText(await translator("en"), "en", NOW);
    const both = usage([
      { kind: "five_hour", usedPercent: 12 },
      { kind: "seven_day", usedPercent: 40 },
    ]);
    expect(planLine(both, pt, NOW.getTime())?.line).toBe("semana 40% · 5h 12%");
    expect(planLine(both, en, NOW.getTime())?.line).toBe("week 40% · 5h 12%");
    expect(planLine(both, pt, NOW.getTime())?.alert).toBeNull();
    // The profile's month row keeps the tightest window alone as its value.
    const top = planLine(both, pt, NOW.getTime())?.top;
    expect(top ? `${pt.short(top)} ${top.used}%` : null).toBe("semana 40%");
    const soon = new Date(NOW.getTime() + 90 * 60_000).toISOString();
    expect(planLine(usage([{ kind: "five_hour", usedPercent: 92, resetsAt: soon }]), pt, NOW.getTime())?.alert).toBe(
      "Quase no limite · renova às 16:30",
    );
    expect(planLine(usage([]), pt, NOW.getTime())).toBeNull();
    // Refused before any window was known: no bar, only that it is at the limit.
    expect(planLine({ ...usage([]), limited: true }, pt, NOW.getTime())).toMatchObject({
      line: "",
      alert: "No limite",
    });
  });

  test("the bars as the web colors them: each window by its own level, the words and the compact bar by the plan's", async () => {
    const parts = await Bun.file(new URL("../../src/features/usage/parts.tsx", import.meta.url).pathname).text();
    expect(parts).toContain('const tone = c[PLAN_TONE[planLevel(shown.top?.used ?? 0, shown.state === "limited")]];');
    expect(parts).toContain('{ color: c[PLAN_TONE[planLevel(used, state === "limited")]] }');
    expect(parts).toContain("const level = planLevel(w.used);");
    expect(parts.match(/color=\{tone\}/g)).toHaveLength(2);
  });

  test("an account's name wraps beside its plan's tag, and whose it is too, as on the web: never an ellipsis", async () => {
    const parts = await Bun.file(new URL("../../src/features/usage/parts.tsx", import.meta.url).pathname).text();
    const head = parts.slice(parts.indexOf("export function AccountHead("), parts.indexOf("function Tag("));
    expect(head).toContain("{accountName(t, account)}");
    expect(head).not.toContain("numberOfLines");
    expect(parts).toMatch(/acctName: \{ flexDirection: "row", flexWrap: "wrap",/);
  });

  test("an agent's usage by account: the figures under the account, as on the web's phone width, never a narrow column", async () => {
    const screen = await Bun.file(
      new URL("../../src/features/usage/AgentUsageScreen.tsx", import.meta.url).pathname,
    ).text();
    expect(screen).toContain("source: { gap: 6, paddingVertical: 12 },");
    expect(screen).toContain('n: { alignItems: "flex-start" },');
    expect(screen).not.toContain("maxWidth: 110");
  });
});

describe("an agent that doesn't answer me", () => {
  const kept = agent({ id: "ada", name: "Ada", canTalk: false });
  const admin = { permissions: ["manage_agents", "talk_to_agents"] } as unknown as OrgSummary;
  const member = { permissions: ["talk_to_agents"] } as unknown as OrgSummary;

  test("Conversar on its page opens the locked conversation for who manages agents, not for a member outside", () => {
    expect(listsAgent(admin, kept)).toBe(true);
    expect(listsAgent(member, kept)).toBe(false);
    expect(listsAgent(member, { ...kept, canTalk: true })).toBe(true);
  });

  test("letting more people in asks first, naming whose mailboxes it would lose, each person once", async () => {
    const t = await translator("pt-BR");
    const box = (accountId: string, ownerName: string | null, address = `${accountId}@acme.com`) => ({
      accountId,
      address,
      ownerUserId: ownerName ? `u-${ownerName}` : null,
      ownerName,
    });
    expect(t("reach.mailLossTitle")).toBe("Tirar o acesso à caixa de email?");
    expect(mailLossText(t, kept, [box("joao", "João"), box("vendas", "João"), box("bia", "Bia")])).toStartWith(
      "Ada tem acesso à caixa de email de João e Bia. Com mais pessoas falando com ela,",
    );
    // Its connector left the workspace: the address names it.
    expect(mailLossText(t, { name: "Theo" }, [box("x", null, "suporte@acme.com")])).toStartWith(
      "Theo tem acesso à caixa de email de suporte@acme.com. Com mais pessoas falando com ele,",
    );
  });

  test("on someone else's plan the one question names whose plan it uses and that they get an email, the mailboxes after", async () => {
    const t = await translator("pt-BR");
    const onPlan = { name: "Ada", brain: { kind: "codex" } as NonNullable<typeof kept.brain> };
    const box = { accountId: "joao", address: "joao@acme.com", ownerUserId: "u-joao", ownerName: "João" };
    expect(widenQuestion(t, onPlan, "João", [])).toEqual({
      title: "Usar o plano de João?",
      description:
        "As conversas com Ada vão usar o plano do ChatGPT de João e os limites dele. João vai receber um email avisando.",
    });
    expect(widenQuestion(t, onPlan, "João", [box])?.description).toContain(
      "João vai receber um email avisando. Ada tem acesso à caixa de email de João.",
    );
    const screen = await Bun.file(new URL("../../src/features/chat/ReachLines.tsx", import.meta.url).pathname).text();
    expect(screen.match(/ask\(audience\)/g)).toHaveLength(2);
  });
});

describe("the light profile (the phone keeps no agents' setup)", () => {
  const read = (file: string) => Bun.file(new URL(`../../${file}`, import.meta.url).pathname).text();
  const did = (key: string, at: string, waiting = false): DidLine => ({
    key,
    icon: "doc",
    title: { key: "file", values: { title: key } },
    sub: null,
    href: null,
    at,
    waiting,
  });

  test("Hoje: what it is on first, then what it did since midnight, newest first, five at most", () => {
    const rows = todayRows(
      [work("ada", ago(0.2))],
      [
        did("ontem", ago(20)),
        did("cedo", ago(5)),
        did("agora", ago(1)),
        did("a", ago(2)),
        did("b", ago(3)),
        did("c", ago(4)),
      ],
      NOW.getTime(),
    );
    expect(rows.map((r) => (r.kind === "work" ? "work" : r.did.key))).toEqual(["work", "agora", "a", "b", "c"]);
    expect(todayRows([], [did("ontem", ago(20))], NOW.getTime())).toEqual([]);
  });

  test("Este mês: a plan's busiest window, else the budget's share, else nothing", () => {
    expect(monthShare({ planUsed: 42, spend: { kind: "percent", percent: 90 } })).toBe(42);
    expect(monthShare({ planUsed: null, spend: { kind: "money", fraction: 0.256 } })).toBe(26);
    expect(monthShare({ planUsed: null, spend: { kind: "percent", percent: 140 } })).toBe(100);
    expect(monthShare({ planUsed: null, spend: null })).toBeNull();
  });

  test("Seu time agora: waiting on you over at work (its plan's bar), then stopped or free", () => {
    const at = work("ada", ago(0.2));
    expect(teamNowOf({ presence: "working", work: [{ ...at, plan: { done: 3, total: 4 } }], waiting: [] })).toEqual({
      kind: "working",
      work: { ...at, plan: { done: 3, total: 4 } },
      progress: 0.75,
    });
    expect(teamNowOf({ presence: "working", work: [at], waiting: [] })).toMatchObject({ progress: null });
    expect(teamNowOf({ presence: "working", work: [at], waiting: [{ title: "Proposta" }] })).toEqual({
      kind: "waiting",
      what: "Proposta",
    });
    expect(teamNowOf({ presence: "waiting", work: [{ ...at, waiting: true }], waiting: [] })).toEqual({
      kind: "waiting",
      what: at.what,
    });
    expect(teamNowOf({ presence: "out", work: [], waiting: [] })).toEqual({ kind: "stopped", why: "out" });
    expect(teamNowOf({ presence: "online", work: [], waiting: [] })).toEqual({ kind: "free" });
    expect(TEAM_ORDER.waiting).toBe(TEAM_ORDER.working);
    expect(TEAM_ORDER.working).toBeLessThan(TEAM_ORDER.free);
    expect(TEAM_ORDER.free).toBeLessThan(TEAM_ORDER.stopped);
  });

  test("the profile: Ligar, Tarefas, Ajustes; Conversar at the foot; the month opens its usage", async () => {
    const [screen, view] = await Promise.all([
      read("src/features/agents/AgentProfileScreen.tsx"),
      read("src/features/agents/ProfileView.tsx"),
    ]);
    // Ligar is the conversation's own call (live voice), after its conversation is open.
    expect(screen).toContain(".then(({ channelId }) => calls.callAgent(id, channelId, name))");
    expect(screen).toContain("router.push(agentTasksHref(id, null))");
    expect(screen).toContain("rightHand ? openRightHandSettings() : openAgentSettings(id)");
    expect(screen).toContain("onPress: () => openAgentUsage(id)");
    expect(screen).toContain("const shown = usageShown(agent?.brain, detail.data?.budgetUsedPercent ?? 0);");
    // Read only: what it can use, its month and who it answers to are words, never a picker.
    expect(screen).not.toMatch(/ReportsToSection|BrakesSection|BudgetSection|openAgentEdit/);
    expect(view).toContain('label={t("mobile.agentLite.uses")}');
    expect(view).toContain('label={t("mobile.agentLite.reportsTo")}');
    // The composer stays the conversation's: a button to it at the foot.
    expect(view).not.toContain("Composer");
    const t = await translator("pt-BR");
    expect([t("mobile.agentLite.call"), t("mobile.agentLite.tasks"), t("mobile.agentLite.settings")]).toEqual([
      "Ligar",
      "Tarefas",
      "Ajustes",
    ]);
    expect(t("mobile.agentLite.talk")).toBe("Conversar");
  });

  test("Ajustes: its AI, its memory and Aprovado sempre; the rest on the website or asked of the right hand", async () => {
    const [settings, elsewhere] = await Promise.all([
      read("src/features/agents/AgentSettingsScreen.tsx"),
      read("src/features/agents/elsewhere.ts"),
    ]);
    expect(settings).toContain("onPress: () => openAgentAi(agent.id)");
    expect(settings).toContain("<Memories agentId={id} name={name} />");
    expect(settings).toContain(
      '<AlwaysApproved agentId={id} name={name} mayRemove={mine || can(org, "approve_actions")} />',
    );
    expect(settings).toContain("onPress={() => openSite(id)}");
    // The website's agent page opens in the in-app browser, never through the app's links (it would come back here).
    expect(elsewhere).toMatch(/openOwnPage\(`\$\{serverUrl\(\)\}\$\{path\}`\)/);
    expect(elsewhere).toContain("?tab=settings");
    expect(elsewhere).toContain("openDm({ agentId: doug.id }, { compose: true");
    const t = await translator("pt-BR");
    expect(t("mobile.agentLite.raiseBudgetF", { name: "ROSA" })).toBe("Aumenta o orçamento da ROSA");
    expect(t("mobile.agentLite.askDoug", { name: "Doug" })).toBe("Pedir ao Doug");
    expect(t("mobile.teamNow.lead", { name: "Doug", count: 5 })).toBe("Doug coordena 5 agentes");
  });
});
