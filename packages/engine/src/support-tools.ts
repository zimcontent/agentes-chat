import { and, eq, schema } from "@agenteschat/db";
import { getMembership } from "./organizations";
import { personBehindCall } from "./requester";
import { queueSupportEmail, SUPPORT_MAX, supportRequestedBy } from "./support";
import type { ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

const { agents, users } = schema;

export const CONTACT_SUPPORT_TOOL = "contact_support";

/**
 * `contact_support`: a person asks the agent for help with the installation itself (something stopped working, a
 * setting doesn't apply), and the agent sends a summary to whoever runs it, by email, in that person's name. It leaves
 * the workspace and reaches the people who deployed this installation, so the person reads it on a card and approves
 * it first; only they do. Listed only where the server has a support address (`SUPPORT_EMAIL`), and never for a run
 * nobody is behind (a routine's, an agent's own).
 */
export function createSupportToolSource(deps: {
  /** Where a summary goes (`SUPPORT_EMAIL`); unset, the tool is not listed. */
  to?: string | null;
  /** This installation's client code (`DOUG_CLIENT_CODE`), when it has one. */
  clientCode?: string | null;
  /** This server's address, for the email's picture. */
  publicUrl: string;
  /** This server's version. */
  version: string;
}): ToolSource {
  const tool: ToolDefinition = {
    name: CONTACT_SUPPORT_TOOL,
    description: `Send a summary of a problem with this installation itself (the app not working, a page that fails, an error someone hit) to whoever runs it, by email in the person's name, only when they ask you to ('chama o suporte', 'avisa quem cuida do sistema', 'abre um chamado'). \`text\`: the problem in that person's language and words: what was being done, what happened as it appeared, when, and what was already tried. Nothing from the conversation they didn't ask to send. They read it on a card and approve it before it goes.`,
    scope: "",
    sensitive: true,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: SUPPORT_MAX } },
      required: ["text"],
      additionalProperties: false,
    },
    describe: (input) => ({
      title: "Send to support",
      detail: typeof input.text === "string" ? input.text.trim() : "",
    }),
    // In their name, so theirs alone to approve; a call nobody is behind has nobody to ask.
    async approvers(_input, ctx) {
      const person = await personBehindCall(ctx);
      if (!person || !(await getMembership(ctx.db, person, ctx.orgId)))
        return { ok: false, message: supportRequestedBy() };
      return {
        ok: true,
        approvers: {
          userIds: [person],
          label: supportRequestedBy(),
          requestedBy: null,
          requesterDecides: false,
          required: true,
        },
      };
    },
    async execute(input, ctx): Promise<ToolOutput> {
      const to = deps.to;
      if (!to) return { content: "This installation takes no support requests: nothing was sent.", isError: true };
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return { content: "Give the problem in `text`.", isError: true };
      const person = await personBehindCall(ctx);
      const member = person ? await getMembership(ctx.db, person, ctx.orgId) : null;
      const [user] = person
        ? await ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, person))
        : [];
      if (!person || !member || !user) return { content: supportRequestedBy(), isError: true };
      const [agent] = await ctx.db
        .select({ name: agents.name, handle: agents.handle })
        .from(agents)
        .where(and(eq(agents.orgId, ctx.orgId), eq(agents.id, ctx.agentId)));
      await queueSupportEmail(ctx.db, {
        orgId: ctx.orgId,
        // One email per call: the same call run again (a retry) goes once.
        key: `${person}:${ctx.runId}:${ctx.toolUseId ?? crypto.randomUUID()}`,
        to,
        publicUrl: deps.publicUrl,
        summary: {
          name: user.name,
          email: user.email,
          orgName: member.orgName,
          text,
          agent: agent ?? null,
          clientCode: deps.clientCode ?? null,
          version: deps.version,
        },
      });
      return {
        content:
          "Sent to support, in their name; an answer goes to their email. Tell them it went and finish your reply.",
      };
    },
  };
  return { name: "support", tools: async () => (deps.to ? [tool] : []) };
}
