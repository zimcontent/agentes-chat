# doug-0013. One agent in several workspaces, trained as one

- Status: Accepted
- Date: 2026-11-16

## Context

A person who runs an operation across several workspaces (one per client, one of their own) has the same agents in
each: the same designer, strategist, operator. Bringing an agent from one workspace to another (ADR 9002) made a copy
once, and from then on each copy learned apart. The rules a person gave in one workspace, what the agent learned there
(its "Learned" lines, its memory), a skill it improved and a tool it was given never reached the other copy. In
production, fifteen agents of one owner lived in two workspaces: one copy held about 760 memories, the other four, and
their instructions had drifted apart by dozens of rules.

The owner's words: "I trained it for the workspace and it already counts for all my active workspaces."

## Decision

1. **One agent, several copies.** The copies of an agent, one per workspace, share a row of `agent_twins` (no `org_id`:
   it spans workspaces, like `connector_sign_ins`) through `agents.twin_id`. Every copy stays a row of its workspace,
   with its `org_id`, so nothing that reads agents changes.

2. **How copies are joined.** Bringing an agent from another workspace joins the copy it makes, and bringing one whose
   handle is already there joins the two (`carryOver`). A person who manages agents in both workspaces (or owns the
   agent) joins or separates them on the agent's page. A person who owns several open workspaces has their own agents of
   the same handle there joined on their own (`autoLinkTwins`, every ten minutes). A copy taken out (`twin_off`) is
   never joined on its own again. The right hand is each workspace's own.

3. **What is training, and travels.** Name, role, instructions, look, voice, call notes and whether it sends stickers.
   Its memory: facts, decisions, preferences, notes, lessons and rules that belong to the agent (scope `agent` or
   `person`). Its team skills and their text. What it may use: built-in tools and connections' scopes.

4. **What stays each workspace's.** Its model, AI key, brain, computer and account, budget, audience, approvals,
   routines, conversations and summaries of them. Memory read from a channel (`channel_ids`): only that workspace's
   members may read it, and the channel isn't in the others. Mailboxes and databases (their own per-agent rules, ADR
   9002 §6). Personal skills stay their person's.

5. **Synced by code, never by a model.** A worker tick (`agentTwins`, every minute) syncs each group whose fingerprint
   (the profiles, the memories, the skills and their versions, the access) changed, under a lease so one replica at a
   time does it. `agent_twins.base` keeps what the copies held at the last sync, so a change made in one copy is told
   apart from what the others hold:
   - Instructions are merged by line (`agent-twins-merge.ts`). One copy changed: everyone's. Several: the newest as it
     is, with each other one's added and removed lines on top. The first sync of a group (or after a copy joins) joins
     the texts: the newest, plus every line of the others it doesn't say; a line close to one it has (word overlap 0.5)
     is the same rule in an older wording and stays out. Nothing a person wrote is lost.
   - Other profile fields: the copy that changed last.
   - Memory: a memory learned in one copy is copied to the others with a shared `context_items.twin_key`; one archived
     (forgotten, superseded) or brought back in one copy is so in all, as the copy that changed last. Memories that
     already said the same thing in two copies are tied, not copied again.
   - Skills: one turned on or off in a copy is in all, and an edit of a skill's text (by a person or the agent improving
     it) is written as a new version of the other workspaces' skill of that name. A workspace without it gets a copy
     with its files. Two copies that read from the same link each update from it.
   - Access: a scope given or taken in one copy is in all. A connection's scope names that connection in its
     workspace: in another it names the same connection there, brought by the person who joined the copies
     (`connectionIn`, as "Trazer de outro workspace" does) when that workspace has none.
   What can't reach a copy (a connection the person can't bring there, a skill without storage) is listed on the
   agent's page.

6. **Where.** The agent's Configurações: "Nos seus outros workspaces", with its copies, the agents of its handle that
   can join, and when the training was last checked. `GET`, `POST` and `DELETE
   /api/app/organizations/{orgId}/agents/{agentId}/twins`.

7. **Schema outside the journal.** The table and columns are this distribution's own, added by `EXTRA_COLUMNS`
   (`packages/db/src/client.ts`), like ADR 9002's.

## Consequences

- Training an agent in one workspace trains it in every workspace where it is the same agent, within a minute.
- Memory learned from one workspace's work (a client's facts) is read by the agent in the others. The owner of all of
  them asked for it. A person who doesn't want it separates the copy.
- Joining two copies that drifted unites them: a rule removed in one and still in the other comes back, and has to be
  removed again (then everyone loses it).
- Two copies editing the same line at once keep both wordings rather than lose one.
- The phone app has no screen for this yet: its agents are synced like any other.
