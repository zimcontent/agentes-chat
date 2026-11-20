import { afterEach, describe, expect, test } from "bun:test";
import { schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import { drainOutbox, grantScopes, listMessages, PROOF_MAX, postPersonMessage, proofOf, proofUrl } from "../src";
import { type Fixture, setup } from "./fixtures";

/** Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md): what a run delivered, read from its steps. */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

describe("proofOf", () => {
  test("files, screenshots, tasks, pages and outside actions, from what the steps returned", () => {
    expect(
      proofOf(
        [
          { name: "create_issue", data: { issue: { id: "i1", number: 42 } } },
          { name: "create_artifact", data: { artifact: { id: "a1", version: 1, title: "relatorio.pdf" } } },
          { name: "mcp__agentes__browser_screenshot", data: { artifact: { id: "a2", version: 1, title: "x.png" } } },
          {
            name: "notion_create_page",
            external: true,
            content:
              '{"id":"p1","url":"https://api.notion.com/v1/pages/p1","permalink":"https://notion.so/acme/Plano-p1?pvs=4"}',
          },
        ],
        [{ tool: "mail_send", targets: ["email:ana@acme.com"] }],
      ),
    ).toEqual([
      { kind: "file", label: "relatorio.pdf", ref: "a1" },
      { kind: "image", label: "", ref: "a2" },
      { kind: "task", label: "#42", ref: "42" },
      { kind: "link", label: "notion.so/acme/Plano-p1", ref: "https://notion.so/acme/Plano-p1" },
      { kind: "action", label: "ana@acme.com" },
    ]);
  });

  test("never from a failed call, a read, or a page with a query; one item per thing", () => {
    expect(
      proofOf([
        { name: "create_artifact", isError: true, data: { artifact: { id: "a1", title: "x" } } },
        // A read names pages too: only a call that makes or changes something proves it.
        { name: "github_get_pr", external: true, content: '{"html_url":"https://github.com/acme/app/pull/7"}' },
        { name: "address_lookup", external: true, content: '{"permalink":"https://maps.acme.com/a"}' },
        { name: "update_issue", data: { issue: { id: "i1", number: 42 } } },
        { name: "comment_issue", data: { issue: { id: "i1", number: 42 } } },
      ]),
    ).toEqual([{ kind: "task", label: "#42", ref: "42" }]);
    expect(proofUrl("https://drive.google.com/file/d/1?token=abc#x")).toBe("https://drive.google.com/file/d/1");
    expect(proofUrl("http://acme.com/a")).toBeNull();
    expect(proofUrl("https://user:pw@acme.com/a")).toBeNull();
  });

  test("team actions: a pull request and a page open, at most PROOF_MAX", () => {
    const items = proofOf(
      [],
      [
        { tool: "open_pull_request", targets: ["github:acme/app#212", "github:acme/app@fix/login"] },
        { tool: "curl", targets: ["url:hooks.acme.com/deal"] },
        ...Array.from({ length: 8 }, (_, i) => ({ tool: "mail_send", targets: [`email:p${i}@acme.com`] })),
      ],
    );
    expect(items.slice(0, 3)).toEqual([
      { kind: "link", label: "app#212", ref: "https://github.com/acme/app/issues/212" },
      { kind: "link", label: "app@fix/login", ref: "https://github.com/acme/app/tree/fix/login" },
      { kind: "link", label: "hooks.acme.com/deal", ref: "https://hooks.acme.com/deal" },
    ]);
    expect(items).toHaveLength(PROOF_MAX);
  });
});

describe("on the reply", () => {
  const DRIVE = ["drive:read", "drive:write"].map((scope) => ({ connectionId: null, scope }));
  const last = (req: ModelRequest) => JSON.stringify(req.messages.at(-1));

  test("the reply that delivers a file carries it; the next message only what came after", async () => {
    f = await setup({
      artifactTools: true,
      reply: (req) => {
        const text = last(req);
        if (text.includes("tool_result")) return { chunks: ["Pronto, está no Drive."] };
        if (text.includes("monta o relatório"))
          return {
            chunks: [],
            toolUses: [{ name: "create_artifact", input: { title: "Relatório", kind: "document", markdown: "# Q3" } }],
          };
        return { chunks: ["Claro."] };
      },
    });
    await grantScopes(f.db, f.org.id, f.agent.id, DRIVE);
    const post = (body: string) =>
      postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body });
    await post("@dev monta o relatório");
    await drainOutbox(f.db, f.handlers);
    const [file] = await f.db.select().from(schema.artifacts);
    const reply = (await listMessages(f.db, f.owner.id, f.org.id, f.general.id)).at(-1);
    expect(reply?.meta.proof).toEqual([{ kind: "file", label: "Relatório", ref: file?.id }]);

    // A run that delivered nothing says nothing.
    await post("@dev tudo certo?");
    await drainOutbox(f.db, f.handlers);
    const next = (await listMessages(f.db, f.owner.id, f.org.id, f.general.id)).at(-1);
    expect(next?.body).toBe("Claro.");
    expect(next?.meta.proof).toBeUndefined();
  });
});
