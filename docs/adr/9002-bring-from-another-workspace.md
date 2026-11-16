# 9002. Bringing connections and agents from another workspace

- Status: Accepted
- Date: 2026-11-14
- Numbering: 9001 and up are this distribution's own decisions, apart from the upstream sequence, so the two never take the same number.

## Context

A person with several workspaces (one per client, one of their own) connected the same services in each: the same
sign-in to Stripe, the same key, the same MCP server reviewed tool by tool, again for every new workspace. The same
goes for an agent they set up well once: its instructions, its skills and what it may use had to be rebuilt by hand.
Connections and agents belong to a workspace (`org_id`), and that stays: what was missing is a way for what a person
made in one of their workspaces to arrive in another without starting over.

Copying a row is not enough for OAuth. Many providers rotate the refresh token on every renewal (the code already
keeps one renewal at a time per connection for that reason): two copies of one sign-in would each hold a refresh
token, the first to renew would spend it, and the other would be refused and ask to be reconnected.

## Decision

1. **Derived from the person's memberships, no account-level store.** What a person can bring into a workspace is
   read from their other workspaces at the moment they ask (`carrySources`): nothing is kept per account, so there
   is no second copy of a secret outside a workspace and nothing to keep in step. A connection only one workspace
   has goes away with that workspace. One brought elsewhere stays there.

2. **Who brings what.** A connection: whoever made it (`created_by_user_id`), or the owner of the workspace it is
   in, while they still manage connectors there, into a workspace where they manage connectors too. An admin who
   didn't make a connection can use it through agents but can't take it to a workspace of their own. An agent:
   whoever manages agents there or owns that agent, into a workspace where they manage and create agents. A
   workspace suspended or being deleted gives nothing. Both sides get an audit row (`connector.carried` where it
   arrives, `connector.carried_out` where it came from, `agent.carried`).

3. **A key is copied, a sign-in is shared.** An API key (or a server with no sign-in) gets a row of its own, its
   secret sealed again for the new workspace and row. An OAuth sign-in with a refresh token becomes one sign-in the
   two connections share: a `connector_sign_ins` row (no `org_id`: it spans workspaces) that both point at
   (`sign_in_id`). Each connection still keeps its own sealed copy of the tokens, so reading a secret is unchanged.
   A renewal takes its lease on the sign-in's row instead of the connection's, and writes the new tokens to every
   live connection of that sign-in in one transaction (`refreshTokens`). Disconnecting one never revokes the token
   at the provider while another uses it, and signing in again on one makes it a sign-in of its own.

4. **The OAuth client comes along.** A sign-in an MCP server's own authorization server gave renews only with the
   client it was given to. The workspace it goes to uses its own row for that issuer when it is the same
   registration, gets a copy when it has none, and when it registered another client there the brought connection
   renews with the row it came from.

5. **Composio.** A service through Composio keeps Composio's connected account, under the Composio user it was made
   for (`composio_user_org_id`). The account goes away at Composio only with the last live connection that uses it,
   on a disconnect and when a workspace is deleted.

6. **What doesn't come.** GitHub through the app alone: an installation belongs to one workspace. A sign-in that
   needs reconnecting. Mailboxes and databases, which have their own per-agent rules and are out of this decision.

7. **Arriving.** A brought connection is every agent's there, like any new one, with a free name and tool prefix. A
   server by address arrives with its tools classified as they were, so there is nothing to review again. Bringing
   the same connection twice is the one already there (`carried_from_id`, the same account or catalog connector).

8. **An agent is its profile, its skills and its access.** Name, handle, role, instructions and look; its enabled
   skills (the workspace's own skill of that name when it has one, else a copy with its files); and its access to
   the connections that came with it, at the level it had. Its own connections come with it without being picked.
   Never its conversations, memory, model key, computer, routines, budget or photo: it thinks with what the new
   workspace's agents think with. A workspace that has an agent with that handle isn't given a second one.

9. **Where.** Settings › Connectors ("Trazer de outro workspace", beside "Adicionar conector") and the onboarding's
   team step, both only when the person has something to bring. One dialog lists each workspace, its agents and its
   connections. A workspace being set up asks: on its team step the dialog opens by itself the first time there is
   something that can still come, once per workspace and browser, and stays behind its link after that. `GET` and `POST /api/app/organizations/{orgId}/carry`.

10. **Schema outside the journal.** The table and the three columns are this distribution's own, added by the
    idempotent statements in `packages/db/src/client.ts` (`EXTRA_COLUMNS`) like its other columns, so upstream's
    migrations keep their numbers.

## Consequences

- A new workspace starts with the person's connections and agents in one step, with no sign-in repeated.
- One provider-side grant now serves several workspaces: revoking it at the provider stops all of them, and each
  says "needs reconnecting" on its own.
- A renewal that fails between the provider's answer and the write leaves every connection of that sign-in with a
  spent refresh token, as it already left one.
- The phone app has no screen for this yet: it reads what was brought like anything else connected.

## Addendum 2026-11-16: AI provider keys

An AI provider key comes too, so a key added in one workspace is not typed again in the next (a cheap model a
ronda thinks with, ADR 9004 §5, is the case that asked for it). Who manages keys in the workspace it comes from
(`manage_credentials`; the owner always) brings it into one where they manage keys too. It is a copy of its own:
opened with the source's seal and sealed again for the new workspace by `createCredential`, which checks it as any new
key (an endpoint's address and models come with it). Listed by provider, name and last characters, never the key; one
the workspace already has (same provider, same ending, same endpoint address) shows "here" and is not copied twice.
The audit log records `credential.carried` with where it came from. The dialog shows them under "Chaves de IA", and
the button is also on the AI keys card (Settings › AI).

## Addendum 2026-11-16: a brought agent stays one agent

§8's "never its memory" is superseded by ADR doug-0013: an agent brought from another workspace is joined to the
agent it came from, and one whose handle is already there is joined to that one. From then on what trains one copy
(profile, memory, skills, access) reaches the other. Its conversations, model key, computer and routines still stay.
