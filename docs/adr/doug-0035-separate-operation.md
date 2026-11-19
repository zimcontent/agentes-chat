# doug-0035: A separate operation, whose agents carry only their craft

Status: accepted. This instance's own. 2026-11-18. Changes doug-0013 (one agent in several workspaces) for groups with a
separate operation in them.

## Context

doug-0013 trains one agent as one across the owner's workspaces: name, instructions, memory, skills and access reach
every copy within a minute. That fits workspaces of one business (one per client, one of the owner's own). It doesn't
fit an owner who runs two businesses with different partners, say a content studio and a film studio, each with its
own clients. The owner's agents work in both, and the owner joins them on purpose, but the second business's partner,
an owner of that workspace, then reads in its agents' memory the other business's clients, decisions and notes. Its
skills name them too, and its connections were brought over on the owner's sign-ins. In production, a copy in the new
workspace held its sibling's memories about the other business's clients within minutes of being joined.

The owner put it as "employees of two companies": a person who works for both carries what they know how to do from one
to the other, never what they saw in either.

## Decision

1. **A workspace setting, owners only.** `organization_settings.separate_operation` (Configurações › Geral,
   "Operação separada"). Read by whoever may `configure` the workspace, changed only by its owners (`manage_owners`),
   because it decides what its agents carry to and from the owner's other workspaces. Every change is audited
   (`organization.separate_operation_changed`).

2. **A fenced group carries only the craft, both ways.** A group of copies with a separate workspace among them
   (`fenceFor` in `separate-operation.ts`) syncs, among all its copies:
   - the profile's name, role, look, voice and stickers as before. Call notes stay each copy's.
   - the instructions line by line: a line that names something of a company the other copy's workspace doesn't know
     stays in its copy, back after the line it followed (`fencedInstructions`). The rest is merged as in doug-0013.
   - memory of the kinds `lesson`, `rule` and `preference`, when it names nothing the receiving workspace doesn't
     know. A memory about a person only goes where that person is a member. Facts, decisions, notes and entity profiles
     stay where they were learned.
   - skills whose text names nothing the other workspaces don't know. A company's own skill stays out of the shared
     sets, so turning it off in one copy doesn't turn it off in the other.
   - built-in tools. A connection's scope is never synced, and no connection is brought: each company gives its own.

3. **What names a company is read in code, never by a model.** A workspace's names are its own name, the names its
   owners keep by hand (`organization_settings.kept_names`: clients, projects, people), and the entities its context
   knows as a client, customer, company, brand, project, account, partner or person (`entity_profile`, ADR 0017). A
   text doesn't cross into a workspace when it names, as a whole word with case and accents ignored, a name another
   workspace of the group owns that the receiving one doesn't know. A workspace knows its own names, its members' names
   and first names, and its agents' names and handles. Names shorter than three letters only count when kept by hand.
   A wrong match keeps a piece of craft home. That is the safe side.

4. **What already crossed goes back.** Turning the setting on clears the fingerprints of every group with a copy
   there (`setSeparateOperation`), so the workers' next tick syncs them. That sync:
   - deletes the copies of memories that may not cross, made since the group was joined. The original stays in the
     workspace where it was learned. Copies are deleted, not archived: a group syncs status between tied copies, and
     an archived copy could carry its archiving back to the original.
   - unties the memories each copy knew on its own that aren't craft, so forgetting one in one company leaves the
     other's alone.
   - turns off for that copy a skill that names another company. The skill leaves the workspace's library
     (soft-deleted) when no agent there uses it.
   - drops instruction lines that name another company.
   Connections aren't removed: a person chose them. The card lists every connection signed in with an account another
   workspace also uses (a shared `sign_in_id` or Composio account): such a connection reaches that account's things
   whatever this setting says, and the card says to connect it again with the operation's own account.

5. **Turning it off** syncs everything again as doug-0013 does, from what each copy holds then.

## Consequences

- An agent page's "Nos seus outros workspaces" card says when only the craft crosses (`craftOnly` on the twins view).
- A computer that serves both workspaces in user mode runs every agent as the same operating system user, so an agent
  of one workspace can read another's folders there. This decision doesn't cover that. A separate operation should run
  its agents on its own computer, or on one in system mode (one user per agent, ADR 0059).
- Groups in which no workspace is separate behave exactly as before.
- Columns of this instance's own, in `EXTRA_COLUMNS`, outside the numbered migrations.
