import { afterEach, describe, expect, test } from "bun:test";
import type { ZimMedia } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  createPhoneToolSource,
  handlePhoneCallReport,
  openPersonAgentDm,
  type PhoneDeps,
  phoneLineView,
  phoneNumberOf,
  postPersonMessage,
  removePhoneLine,
  rightHandId,
  savePhoneLine,
  setPhoneEngine,
  type ToolContext,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** Phone calls (docs/adr/doug-0035-phone-calls.md): an owner's line, the Doug's `phone_call`, and the call's report. */

let f = undefined as unknown as Fixture;
afterEach(async () => {
  const open = f;
  f = undefined as unknown as Fixture;
  await open?.close();
});

const URL_ = "https://ligar.example.com";
const TOKEN = "line-token-0123456789-abcd";

/** A fake calling service: `/line` answers its number to the right token, `/call` keeps what it was asked. */
function service() {
  const calls: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${TOKEN}`) return Response.json({ error: "no" }, { status: 401 });
    if (u === `${URL_}/line`) return Response.json({ from: "+19788980563", engines: ["gpt-live", "qwen", "other"] });
    if (u === `${URL_}/call`) {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ sid: "CA123" });
    }
    return new Response("?", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function deps(fetch: typeof globalThis.fetch, media: ZimMedia | null = null): PhoneDeps {
  return {
    media,
    db: f.db,
    pubsub: f.pubsub,
    keyWrapper: f.keyWrapper,
    keyWrappers: [f.keyWrapper],
    publicUrl: "https://doug.example.com/",
    fetch,
  };
}

/** A run of the Doug for `userId`, from their message in its DM. */
async function dougRun(userId: string, body = "Liga pro Diego") {
  const doug = (await rightHandId(f.db, f.org.id)) as string;
  const dm = await openPersonAgentDm(f.db, f.org.id, userId, doug);
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, userId, f.org.id, dm.id, { body });
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, f.org.id), eq(schema.agentRuns.triggerMessageId, message.id)));
  if (!run) throw new Error("no run");
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    agentId: doug,
    runId: run.id,
    channelId: dm.id,
    threadRootId: message.id,
    triggerMessageId: message.id,
  };
  return { doug, dm, ctx };
}

describe("a number as people type it", () => {
  test("E.164, or nothing", () => {
    expect(phoneNumberOf("+55 (11) 99017-3148")).toBe("+5511990173148");
    expect(phoneNumberOf("11 99017-3148")).toBeNull();
    expect(phoneNumberOf("+1 432 312 5338")).toBe("+14323125338");
  });
});

describe("an owner's phone line", () => {
  test("checked with the service, sealed, the owner's own; others see only that calls are on", async () => {
    f = await setup({ rightHand: true });
    const fake = service();
    const d = deps(fake.fetch);
    expect(await phoneLineView(d, f.owner.id, f.org.id)).toEqual({
      state: "off",
      fromNumber: "",
      mine: null,
      editable: true,
      engine: "gpt-live",
      engines: ["gpt-live"],
      canChoose: true,
      credits: null,
    });
    await expect(
      savePhoneLine(d, f.owner.id, f.org.id, { url: URL_, token: "wrong-token-0123456789" }),
    ).rejects.toThrow("refused this token");
    await expect(savePhoneLine(d, f.owner.id, f.org.id, { url: "http://x.y", token: TOKEN })).rejects.toThrow(
      "https://",
    );
    const view = await savePhoneLine(d, f.owner.id, f.org.id, { url: `${URL_}/`, token: TOKEN });
    expect(view).toEqual({
      state: "ok",
      fromNumber: "+19788980563",
      mine: { url: URL_, fromNumber: "+19788980563", hint: "abcd" },
      editable: true,
      engine: "gpt-live",
      engines: ["gpt-live", "qwen"],
      canChoose: true,
      credits: null,
    });
    const [row] = await f.db.select().from(schema.phoneLines);
    expect(JSON.stringify(row)).not.toContain("line-token");
    const admin = await addMember(f.db, f.org.id, "admin", "Bia");
    expect(await phoneLineView(d, admin.id, f.org.id)).toEqual({
      state: "ok",
      fromNumber: "+19788980563",
      mine: null,
      editable: false,
      engine: "gpt-live",
      engines: ["gpt-live", "qwen"],
      canChoose: true,
      credits: null,
    });
    await expect(savePhoneLine(d, admin.id, f.org.id, { url: URL_, token: TOKEN })).rejects.toThrow("owner");
    expect(await removePhoneLine(d, f.owner.id, f.org.id)).toMatchObject({ state: "off", mine: null });
  });
});

describe("the Doug's phone_call", () => {
  test("only the right hand, only for owners and administrators, only with a line", async () => {
    f = await setup({ rightHand: true });
    const d = deps(service().fetch);
    const source = createPhoneToolSource(d);
    const owner = await dougRun(f.owner.id);
    expect(await source.tools(owner.ctx)).toEqual([]);
    await savePhoneLine(d, f.owner.id, f.org.id, { url: URL_, token: TOKEN });
    expect((await source.tools(owner.ctx)).map((t) => t.name)).toEqual(["phone_call"]);
    expect((await source.tools(owner.ctx))[0]?.sensitive).toBe(true);
    // Another agent, a routine, a plain member: nothing.
    expect(await source.tools({ ...owner.ctx, agentId: f.agent.id })).toEqual([]);
    expect(await source.tools({ ...owner.ctx, background: true })).toEqual([]);
    const member = await addMember(f.db, f.org.id, "member", "Caio");
    expect(await source.tools((await dougRun(member.id)).ctx)).toEqual([]);
  });

  test("the call goes out with the brief and a one-use address; what was said comes back once, for the Doug", async () => {
    f = await setup({ rightHand: true });
    const fake = service();
    const d = deps(fake.fetch);
    await savePhoneLine(d, f.owner.id, f.org.id, { url: URL_, token: TOKEN });
    const { ctx, doug, dm } = await dougRun(f.owner.id);
    const [tool] = await createPhoneToolSource(d).tools(ctx);
    expect(tool?.rememberTarget?.({ to: "+55 11 99017-3148" })).toBe("+5511990173148");
    const bad = await tool?.execute({ to: "99017-3148", brief: "oi" }, ctx);
    expect(bad?.isError).toBe(true);
    const out = await tool?.execute(
      { to: "+1 432 312 5338", name: "Diego", brief: "Explique como o DougBot vai funcionar." },
      ctx,
    );
    expect(out?.isError).toBeFalsy();
    expect(fake.calls).toHaveLength(1);
    const sent = fake.calls[0] as { to: string; about: string; name: string; agent: { name: string }; report: string };
    expect(sent.to).toBe("+14323125338");
    expect(sent.about).toBe("Explique como o DougBot vai funcionar.");
    expect(sent.name).toBe("Diego");
    const [call] = await f.db.select().from(schema.phoneCalls);
    expect(call).toMatchObject({ status: "calling", to: "+14323125338", agentId: doug, lineUserId: f.owner.id });
    expect(call?.providerCallId).toBe("CA123");
    const prefix = `https://doug.example.com/api/webhooks/phone-call/${call?.id}/`;
    expect(sent.report.startsWith(prefix)).toBe(true);
    const secret = sent.report.slice(prefix.length);

    const report = {
      status: "ended",
      seconds: 130,
      lines: [
        { who: "agent", text: "Oi Diego, aqui é o Doug." },
        { who: "person", text: "Fala, Doug! Me manda o link do app depois." },
        { who: "agent", text: "Mando sim. Tchau!" },
      ],
    };
    expect(await handlePhoneCallReport(d, call?.id as string, "wrong", report)).toBe(false);
    expect(await handlePhoneCallReport(d, call?.id as string, secret, report)).toBe(true);
    expect(await handlePhoneCallReport(d, call?.id as string, secret, report)).toBe(false);
    const [ended] = await f.db.select().from(schema.phoneCalls);
    expect(ended).toMatchObject({ status: "ended", seconds: 130 });
    expect(ended?.lines).toHaveLength(3);
    const notices = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, dm.id), eq(schema.messages.authorAgentId, doug)));
    const notice = notices.find((m) => (m.meta as { notice?: unknown })?.notice);
    const meta = notice?.meta as { notice: { kind: string; text: string }; readOutside?: boolean };
    expect(meta.notice.kind).toBe("wait_result");
    expect(meta.readOutside).toBe(true);
    expect(meta.notice.text).toContain("Me manda o link do app depois.");
    expect(meta.notice.text).toContain("<external_data");
    expect(meta.notice.text).toContain("insight");
  });

  test("nobody answered: the Doug hears that, and offers to try again", async () => {
    f = await setup({ rightHand: true });
    const fake = service();
    const d = deps(fake.fetch);
    await savePhoneLine(d, f.owner.id, f.org.id, { url: URL_, token: TOKEN });
    const { ctx } = await dougRun(f.owner.id);
    const [tool] = await createPhoneToolSource(d).tools(ctx);
    await tool?.execute({ to: "+5551980221050", brief: "Diga oi." }, ctx);
    const [call] = await f.db.select().from(schema.phoneCalls);
    const secret = (fake.calls[0] as { report: string }).report.split("/").at(-1) as string;
    expect(await handlePhoneCallReport(d, call?.id as string, secret, { status: "failed", lines: [] })).toBe(true);
    const [ended] = await f.db.select().from(schema.phoneCalls);
    expect(ended?.status).toBe("failed");
  });
});

/** A fake credits wallet: a price per minute, a balance, and the charges it took. */
function wallet(balance: number, perMinute = 100) {
  const charges: { orgId: string; idempotencyKey: string; engine?: string; seconds: number }[] = [];
  const media = {
    catalog: async () => ({ models: [], packs: [], calls: { qwen: { creditsPerMinute: perMinute } } }),
    balance: async () => ({ balance }),
    chargeCall: async (orgId: string, input: { idempotencyKey: string; engine?: string; seconds: number }) => {
      charges.push({ orgId, ...input });
      const credits = Math.ceil((perMinute * input.seconds) / 60);
      balance -= credits;
      return { credits, unpaid: 0, balance, repeated: false };
    },
  } as unknown as ZimMedia;
  return { media, charges };
}

describe("the house voice (Qwen), paid in credits", () => {
  test("chosen by who configures; only with a wallet", async () => {
    f = await setup({ rightHand: true });
    await expect(setPhoneEngine(deps(service().fetch), f.owner.id, f.org.id, "qwen")).rejects.toThrow("credits");
    const { media } = wallet(500);
    const d = deps(service().fetch, media);
    const member = await addMember(f.db, f.org.id, "member", "Caio");
    await expect(setPhoneEngine(d, member.id, f.org.id, "qwen")).rejects.toThrow();
    await expect(setPhoneEngine(d, f.owner.id, f.org.id, "nope")).rejects.toThrow("Unknown voice");
    const view = await setPhoneEngine(d, f.owner.id, f.org.id, "qwen");
    expect(view).toMatchObject({ engine: "qwen", credits: { perMinute: 100, balance: 500 } });
  });

  test("no call without a minute of credits; a call lasts what they pay for, and is charged by the second", async () => {
    f = await setup({ rightHand: true });
    const fake = service();
    const poor = wallet(50);
    await savePhoneLine(deps(fake.fetch, poor.media), f.owner.id, f.org.id, { url: URL_, token: TOKEN });
    await setPhoneEngine(deps(fake.fetch, poor.media), f.owner.id, f.org.id, "qwen");
    const { ctx } = await dougRun(f.owner.id);
    const [tool] = await createPhoneToolSource(deps(fake.fetch, poor.media)).tools(ctx);
    const refused = await tool?.execute({ to: "+5511990173148", brief: "Diga oi." }, ctx);
    expect(refused?.isError).toBe(true);
    expect(refused?.content).toContain("Not enough credits");
    expect(fake.calls).toHaveLength(0);

    const rich = wallet(1000);
    const d = deps(fake.fetch, rich.media);
    const out = await tool?.execute({ to: "+5511990173148", brief: "Diga oi." }, ctx);
    expect(out?.isError).toBe(true); // the tool keeps the deps it was made with
    const [paid] = await createPhoneToolSource(d).tools(ctx);
    expect((await paid?.execute({ to: "+5511990173148", brief: "Diga oi." }, ctx))?.isError).toBeFalsy();
    const sent = fake.calls[0] as { engine: string; maxSeconds: number; report: string };
    expect(sent.engine).toBe("qwen");
    expect(sent.maxSeconds).toBe(600);
    const [call] = await f.db.select().from(schema.phoneCalls);
    expect(call?.engine).toBe("qwen");
    const secret = sent.report.split("/").at(-1) as string;
    const lines = [
      { who: "agent", text: "Oi!" },
      { who: "person", text: "Oi, Doug." },
    ];
    expect(await handlePhoneCallReport(d, call?.id as string, secret, { status: "ended", seconds: 90, lines })).toBe(
      true,
    );
    expect(rich.charges).toEqual([
      { orgId: f.org.id, idempotencyKey: call?.id as string, engine: "qwen", seconds: 90 },
    ]);
    const [ended] = await f.db.select().from(schema.phoneCalls);
    expect(ended?.credits).toBe(150);
  });
});
