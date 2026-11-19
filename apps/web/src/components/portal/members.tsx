import { listsAgent } from "@dougbot/client/lib/audience";
import { type AvatarProps, AvatarStack } from "@dougbot/ui";
import { ActorAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";

/**
 * Someone on a card (ADR 9001): a person of the workspace or one of its agents. A card keeps only their ids, people's
 * and agents' in one list, the one responsible first.
 */
export interface PortalWho {
  type: "person" | "agent";
  id: string;
  name: string;
}

/**
 * Who a card's member ids are, and who can be put on a card: the workspace's people, then the agents the person's
 * lists show (and any agent already on the card, which stays in sight so it can be taken off).
 */
export function usePortalPeople() {
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const who = (id: string): PortalWho | null => {
    const person = dir.memberById.get(id);
    if (person) return { type: "person", id, name: person.name };
    // An agent no longer in the team still names the work it was on.
    const agent = dir.anyAgent(id);
    return agent ? { type: "agent", id, name: agent.name } : null;
  };
  return {
    who,
    /** The ones of `ids` the workspace knows, in their order. */
    known: (ids: readonly string[]): PortalWho[] => ids.flatMap((id) => who(id) ?? []),
    choices: (on: readonly string[] = []): PortalWho[] => [
      ...dir.members.map((m) => ({ type: "person" as const, id: m.userId, name: m.name })),
      ...dir.agents
        .filter((a) => listsAgent(org, a) || on.includes(a.id))
        .map((a) => ({ type: "agent" as const, id: a.id, name: a.name })),
    ],
  };
}

/** A member's face: a person's photo or initials, an agent's own living symbol. */
export function WhoFace({ who, ...rest }: { who: PortalWho } & Pick<AvatarProps, "size" | "title" | "labelled">) {
  return <ActorAvatar actor={{ type: who.type, id: who.id }} name={who.name} {...rest} />;
}

/** Who is on a piece of work, as small faces (at most `max`), the one responsible first. */
export function MemberFaces({ ids, max, className }: { ids: readonly string[]; max?: number; className?: string }) {
  const people = usePortalPeople().known(ids);
  if (people.length === 0) return null;
  return (
    <AvatarStack className={className}>
      {people.slice(0, max).map((w) => (
        <WhoFace key={w.id} who={w} size="xs" title={w.name} labelled />
      ))}
    </AvatarStack>
  );
}
