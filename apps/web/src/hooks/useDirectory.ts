import type { Actor, Agent, Member, Message } from "@dougbot/client";
import { useAgents, useFormerAgents, useMembers, useRoles } from "@dougbot/client";
import { agentsByAnyHandle, formerById } from "@dougbot/client/lib/directory";
import { memberRoleColor } from "@dougbot/client/lib/member-groups";
import { type AgentColor, agentGradient, botDoAgente, corDoBot, DougBot } from "@dougbot/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { lookOf } from "@/lib/look";

/** People and agents of the organization, by id and handle, for names and avatars. */
export function useDirectory(orgId: string) {
  const { t } = useTranslation();
  const agents = useAgents(orgId);
  const former = useFormerAgents(orgId);
  const members = useMembers(orgId);
  const roles = useRoles(orgId);
  return useMemo(() => {
    const roleById = new Map((roles.data?.roles ?? []).map((r) => [r.id, r]));
    /** A role's name, for whom an agent answers ("Suporte"). */
    const roleName = (id: string) => roleById.get(id)?.name;
    const agentById = new Map<string, Agent>((agents.data ?? []).map((a) => [a.id, a]));
    const gone = formerById(former.data);
    /** The team's agent, or one no longer in it (archived or deleted): what it left still names it. */
    const anyAgent = (id: string) => agentById.get(id) ?? gone.get(id);
    const agentByHandle = agentsByAnyHandle(agents.data ?? []);
    // The uploaded photo wins over the sign-in image (`image` is what every avatar reads).
    const people = (members.data ?? []).map((m) => (m.avatarUrl ? { ...m, image: m.avatarUrl } : m));
    const memberById = new Map<string, Member>(people.map((m) => [m.userId, m]));
    const memberByHandle = new Map<string, Member>(
      (members.data ?? []).filter((m) => m.handle).map((m) => [m.handle.toLowerCase(), m]),
    );
    const authorName = (author: Message["author"]) =>
      author.type === "agent"
        ? (anyAgent(author.id ?? "")?.name ?? t("channel.unknownAgent"))
        : (memberById.get(author.id ?? "")?.name ?? t("channel.unknownPerson"));
    // Agents sharing a first letter get two (Ada "A", Atlas "At").
    const initials = new Map<string, string>();
    const used = new Set<string>();
    for (const a of agents.data ?? []) {
      const first = (a.name.trim()[0] ?? "?").toUpperCase();
      const value = used.has(first) ? `${first}${a.name.trim()[1] ?? ""}` : first;
      used.add(first);
      initials.set(a.id, value);
    }
    const agentInitials = (agentId: string) => initials.get(agentId);
    /** `@ada` → "Ada", `@joao` → "João"; unknown handles stay as typed. */
    const mentionName = (handle: string) =>
      agentByHandle.get(handle.toLowerCase())?.name ?? memberByHandle.get(handle.toLowerCase())?.name ?? null;
    /** The workspace member a handle names (with their photo); undefined for an agent or an unknown handle. */
    const mentionPerson = (handle: string) => {
      const key = handle.toLowerCase();
      if (agentByHandle.has(key)) return undefined;
      const member = memberByHandle.get(key);
      return member ? (memberById.get(member.userId) ?? member) : undefined;
    };
    /**
     * A mention's color: an agent's bot's, a person's role's, as their name shows in the bubbles (`nameColorOf`);
     * none for a person with no colored role or an unknown handle (a neutral chip).
     */
    const mentionTone = (handle: string): AgentColor | undefined => {
      const agent = agentByHandle.get(handle.toLowerCase());
      // Its bot's color (IDENTIDADE.md: a bot's color shows where it is), a hex the chip's gradient takes.
      if (agent)
        return corDoBot(
          botDoAgente({
            name: agent.name,
            handle: agent.handle,
            role: agent.role,
            builtin: agent.builtin,
            look: lookOf(agent),
          }),
        ) as AgentColor;
      const person = mentionPerson(handle);
      return person ? (memberRoleColor(person, roles.data?.roles ?? []) as AgentColor | undefined) : undefined;
    };
    /** Who a handle names, for the face before their mention: an agent or a member; undefined for anyone else. */
    const mentionWho = (handle: string): (Actor & { id: string; name: string }) | undefined => {
      const agent = agentByHandle.get(handle.toLowerCase());
      if (agent) return { type: "agent", id: agent.id, name: agent.name };
      const person = mentionPerson(handle);
      return person ? { type: "person", id: person.userId, name: person.name } : undefined;
    };
    /** A name's color in the bubbles, on a light and a dark surface: an agent's own, a person's role's; none: the ink. */
    const nameColorOf = (author: Message["author"]) => {
      // An agent's name in its bot's color (IDENTIDADE.md §6 "Mensagem"); on a light surface a darker tone of it, to
      // read AA on white.
      if (author.type === "agent") {
        const a = anyAgent(author.id ?? "");
        const cor = corDoBot(
          botDoAgente(
            a ? { name: a.name, handle: a.handle, role: a.role, builtin: a.builtin, look: lookOf(a) } : { name: "" },
          ),
        );
        return [DougBot.mix(cor, "#000000", 0.55), cor] as const;
      }
      const color = memberRoleColor(memberById.get(author.id ?? "") ?? { role: "member" }, roles.data?.roles ?? []);
      if (!color) return undefined;
      const [top, deep] = agentGradient(color as AgentColor);
      return [deep, top] as const;
    };
    return {
      agents: agents.data ?? [],
      members: people,
      agentById,
      anyAgent,
      agentByHandle,
      memberById,
      memberByHandle,
      authorName,
      mentionName,
      mentionPerson,
      mentionWho,
      mentionTone,
      agentInitials,
      nameColorOf,
      roleName,
      loading: agents.isPending || members.isPending,
    };
  }, [agents.data, former.data, members.data, roles.data, agents.isPending, members.isPending, t]);
}
