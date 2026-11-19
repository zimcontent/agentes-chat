import { afterEach, describe, expect, test } from "bun:test";
import { APNS_CATEGORY, createFakePushSender } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import type { BlockSpec } from "@dougbot/ui/blocks/spec";
import {
  BLOCK_ACTION_PREFIX,
  blockPushActions,
  deliverPush,
  drainOutbox,
  fileIdsOf,
  getBlockState,
  notificationButtonsOf,
  notify,
  OPEN_ACTION,
  postPersonMessage,
  pressBlockButton,
  pushBlockOf,
  registerPushDevice,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const IPHONE = "c0de".repeat(16);

/** The morning's card: what the day holds, a question, and its answers. */
const DAY: BlockSpec = {
  state: { confirmada: false },
  parts: [
    {
      type: "list",
      items: ["3 compromissos, o primeiro às 10h", "A proposta da Five Rings sai às 9h", "1 lead novo no WhatsApp"],
    },
    { type: "text", text: "Confirmo a call das 10h com a Connor? Dá para desfazer depois." },
    {
      type: "actions",
      buttons: [
        { label: "Confirmar", say: "Pode confirmar a call das 10h", set: { confirmada: "true" } },
        { label: "Remarcar", say: "Remarca a call das 10h" },
        { label: "Outra coisa", say: "Outra coisa" },
      ],
    },
  ],
} as unknown as BlockSpec;

function agent(req: ModelRequest) {
  const text = JSON.stringify(req.messages.at(-1)?.content);
  if (text.includes("tool_result")) return { chunks: ["Seu dia."] };
  if (text.includes("meu dia")) {
    return { chunks: [], toolUses: [{ name: "show_block", input: { title: "Seu dia", spec: DAY } }] };
  }
  return { chunks: ["ok"] };
}

/** The agent's card in #general, and the message that carries it. */
async function card() {
  f = await setup({ blockTools: true, reply: agent });
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev meu dia",
  });
  await drainOutbox(f.db, f.handlers);
  const [block] = await f.db.select().from(schema.artifacts);
  if (!block) throw new Error("no block");
  const rows = await f.db.select().from(schema.messages).where(eq(schema.messages.authorType, "agent"));
  const message = rows.find((m) => fileIdsOf(m.meta).includes(block.id));
  if (!message) throw new Error("no message with the block");
  return { block, message };
}

describe("a live block's buttons on the lock screen", () => {
  test("the one mapping: the first actions part, its first two buttons that do something", () => {
    const buttons = notificationButtonsOf({
      parts: [
        { key: "0", kind: "text" } as never,
        {
          key: "1",
          kind: "row",
          parts: [
            {
              key: "1.0",
              kind: "actions",
              align: "end",
              buttons: [
                { key: "1.0.0", label: "Nada", set: null, draw: null, say: null, lead: false },
                { key: "1.0.1", label: "Sim", set: null, draw: null, say: "sim", lead: false },
                { key: "1.0.2", label: "Não", set: { x: 1 }, draw: null, say: null, lead: false },
                { key: "1.0.3", label: "Talvez", set: null, draw: null, say: "talvez", lead: false },
              ],
            },
          ],
        } as never,
      ],
    });
    expect(buttons).toEqual([
      { key: "1.0.1", label: "Sim" },
      { key: "1.0.2", label: "Não" },
    ]);
  });

  test("the same words make the same category, a valid one, with Abrir last", () => {
    const one = blockPushActions([{ key: "2.0", label: "Confirmar" }], "Abrir");
    expect(one.category).toMatch(APNS_CATEGORY);
    expect(one.actions).toEqual([
      { id: `${BLOCK_ACTION_PREFIX}2.0`, title: "Confirmar", background: true },
      { id: OPEN_ACTION, title: "Abrir" },
    ]);
    expect(blockPushActions([{ key: "2.0", label: "Confirmar" }], "Abrir").category).toBe(one.category);
    expect(blockPushActions([{ key: "2.0", label: "Confirm" }], "Open").category).not.toBe(one.category);
  });

  test("a push about the card carries its buttons and its ids; the iPhone gets them in its language", async () => {
    const { block, message } = await card();
    expect(await pushBlockOf(f.artifactDeps, f.org.id, message.id)).toMatchObject({
      artifactId: block.id,
      version: 1,
      buttons: [
        { label: "Confirmar", key: expect.any(String) },
        { label: "Remarcar", key: expect.any(String) },
      ],
    });
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    await registerPushDevice(f.db, bia.id, { token: IPHONE, platform: "ios", locale: "pt-BR" });
    const [n] = await notify(
      { db: f.db, pubsub: f.pubsub },
      {
        orgId: f.org.id,
        userIds: [bia.id],
        kind: "agent_reply",
        groupKey: "agent_reply:day",
        actor: { type: "agent", id: f.agent.id },
        source: { channelId: f.general.id, messageId: message.id },
        latest: { text: "Seu dia." },
      },
    );
    const push = createFakePushSender();
    await deliverPush({ db: f.db, push, artifacts: f.artifactDeps }, n?.id ?? "");
    const [sent] = push.sent;
    expect(sent?.data).toMatchObject({ blockId: block.id, blockVersion: "1" });
    expect(sent?.actions?.map((a) => a.title)).toEqual(["Confirmar", "Remarcar", "Abrir"]);
    expect(sent?.category).toMatch(/^doug\.block\./);

    // Without where blocks are read, the same push goes without buttons.
    const plain = createFakePushSender();
    await deliverPush({ db: f.db, push: plain }, n?.id ?? "");
    expect(plain.sent[0]?.actions).toBeUndefined();
  });

  test("a press runs the button as a tap would: its values, its message, once for a press that comes twice", async () => {
    const { block, message } = await card();
    const found = await pushBlockOf(f.artifactDeps, f.org.id, message.id);
    const confirm = found?.buttons[0]?.key ?? "";
    const deps = { ...f.artifactDeps, pubsub: f.pubsub };
    const first = await pressBlockButton(deps, f.owner.id, f.org.id, block.id, {
      version: 1,
      key: confirm,
      clientId: "push-1",
    });
    expect(first.changed).toBe(true);
    expect(first.messageId).toBeString();
    const again = await pressBlockButton(deps, f.owner.id, f.org.id, block.id, {
      version: 1,
      key: confirm,
      clientId: "push-1",
    });
    expect(again.messageId).toBe(first.messageId);
    const said = await f.db.select().from(schema.messages).where(eq(schema.messages.authorUserId, f.owner.id));
    expect(said.filter((m) => m.body.includes("Pode confirmar a call das 10h"))).toHaveLength(1);
    expect((await getBlockState(f.artifactDeps, f.owner.id, f.org.id, block.id, 1)).state.confirmada).toBe(true);

    await expect(pressBlockButton(deps, f.owner.id, f.org.id, block.id, { version: 1, key: "9.9" })).rejects.toThrow();
  });

  test("someone outside the workspace can't press it", async () => {
    const { block, message } = await card();
    const found = await pushBlockOf(f.artifactDeps, f.org.id, message.id);
    const [stranger] = await f.db
      .insert(schema.users)
      .values({ id: "stranger", name: "Estranho", email: "estranho@example.com" })
      .returning();
    await expect(
      pressBlockButton({ ...f.artifactDeps, pubsub: f.pubsub }, stranger?.id ?? "", f.org.id, block.id, {
        version: 1,
        key: found?.buttons[0]?.key ?? "",
      }),
    ).rejects.toThrow();
  });
});
