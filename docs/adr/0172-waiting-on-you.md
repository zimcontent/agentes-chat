# 0172. Esperando você: one place for what waits on a person

- Status: Accepted
- Date: 2026-11-11
- Extends: the inbox (`packages/engine/src/notifications.ts`), an agent's open requests (`open-requests.ts`)

## Context

Several things stop until a person acts: an agent's question (`ask_user`), an approval, a secret, help on an agent's
screen, a proposal, a device asking to join. Each has its own card in its conversation, and people met them one by
one. Agents could not see each other's open requests, so one would ask something new while another's question to the
same person still waited, and the conversation filled with questions.

Each of these flows already writes a row in the person's inbox with `waiting: true` and resolves it when the wait
ends (answered, decided, given, expired, withdrawn). The inbox counts those rows, lists them first, pushes its counts
to the person's topic, and drops an approval the person may no longer decide.

## Decision

### 1. The inbox is the record

"Esperando você" is a view of the inbox's waiting rows, never a second list. `listWaiting` (`waiting.ts`) reads them
oldest first, at most 100, by the inbox's own rule (not done, not snoozed, an approval only while the person may
decide it), and leaves out what was asked in a conversation the person can no longer read. Two statements whatever
the number of items. `GET /api/app/organizations/{orgId}/waiting` returns them (`channelId` for one conversation).

A new kind of wait joins the list by writing its inbox row with `waiting: true`, as every existing one does. Nothing
else has to know about it.

### 2. No new realtime event

The list changes exactly when the inbox does, so the apps refetch it on the events the inbox already sends to the
person's topic: `notification.upserted` of a waiting row and `notification.removed`. The count is the `waiting` of
`notification.counts`.

### 3. Agents read what already waits on the person

On a turn where an agent could ask (the turns that read its own open requests) and a person wrote the message, its
prompt gets "# Already waiting on this person": what other agents asked that person and nobody answered, one
statement. Only what was asked in the same conversation is quoted. The rest is a count, because the people in this
conversation may not read where it was asked. With nothing waiting the block is absent. The agent's own requests
stay under "# Your open requests".

### 4. Where people see it

- Web: a sidebar tool, "Esperando você", in the list while its count is above zero (`auto`, like Aprovações), with a
  neutral count. It opens `/org/{orgId}/waiting`, the inbox page showing only what waits, each item as the card its
  conversation draws, answered in place.
- In a conversation: the line above the composer already says a request whose card is loaded and out of view. It now
  also counts what waits on the person there with no card loaded (older messages, a thread), and "Ver" goes to the
  oldest.
- Phone: Atividade's Esperando filter and its tab count, and the strip on Conversas, already read the same rows. The
  conversation's line gets the same count.

### 5. Aprovações stays

Aprovações keeps what only it has: history, rules, approving for someone else, proposals. An approval the person may
decide shows in "Esperando você" as its own card and is decided there or in Aprovações. Both counts can show at once.

## Consequences

- A person who snoozes or marks a waiting row done takes it out of the list and the count. The wait itself goes on
  until answered or expired.
- A question asked of "anyone here" waits on the person behind the run, as its inbox row does, not on every member.
- One more statement before the model call on turns with tools (`budget-queries.test.ts`).

## Addendum (2026-11-14): one entry in the web sidebar

§4 and §5 gave the web two tools, "Esperando você" and Aprovações, each with its own count. An approval a person may
decide was in both, so the same thing showed twice, under two numbers that never matched. People asked which of the
two to open.

- The web sidebar lists one tool for what waits on a person: "Esperando você". Aprovações is no longer a tool there
  (`toolsHere`), neither in the list nor in More. A place a person saved for it is kept and unused.
- Its page has three tabs (`ApprovalsTabs`): "Esperando você" (the inbox's waiting rows, each answered in place),
  Aprovações (the requests with their history, rules and approving for someone else) and proposals. The addresses
  stay: `/waiting`, `/approvals`, `/proposals`. On any of them the one row is lit, unless proposals have a row of
  their own.
- One count: the approvals and proposals waiting for the person, plus what else waits in the inbox (a question, a
  secret, a device). An approval counts once. Until the waiting list loads, the larger of the two counts shows.
- Go to… still names each page.

Aprovações keeps everything §5 says only it has; it is reached as a tab, not as a second entry.
