# doug-0039: Connect and continue

Status: accepted. This instance's own. 2026-11-20. Builds on ADR 0061 (action cards), ADR 0085 (permissions), ADR
0097 (how a turn ends, a step that needs a person is handed over), ADR 0107 (services through Composio), ADR 0109
(means and the turn-end judge) and the device waits (`device-waits.ts`).

## Context

Agents told people "I don't have access to Google Ads" and stopped. The person then had to find where apps are
connected, connect it, come back and ask again. Most of the machinery to do better was there: the `connect_app` card
(`offer_connect_app`) opens the app's own connect dialog, runs pause on a tool call and resume with its result
(`data.pause`, `resumeRunWithResult`), a person's message moves a waiting run on and a late result comes back as a
notice (`detachWaits`), `request_permission` asks for a connection that exists but isn't given to the agent. What was
missing was the link between "the service got connected" and "the task goes on".

## Decision

**`request_connection` (tool, `connection-requests.ts`).** Any agent, any run a person is behind (the run policy
refuses it to routines, `ELSEWHERE`; its card is the question, `ASKS_ITSELF`). Input: the service by name or id
(matched to a catalog connector or a one-click preset with `catalogConnector`, as this server lists it), `why` (one
line on the card) and `next` (what it does once connected). It answers without a card when the agent already holds
the service, points to `request_permission` when the workspace has it but the agent doesn't (the existing approval
covers the second layer of scopes and resumes the run), and refuses a service this server can't connect.

Otherwise it writes a `connection_requests` row (`EXTRA_COLUMNS`), posts the `connect_app` card with
`params.request` (`state`, `askedUserIds`, `runId`) and parks the run on the wait id `connection:<request id>`. A
second call in the same run waits on the same request.

**Who connects.** A person who may `manage_connectors` gets the Connect button. Anyone else reads who was asked: every
member who may connect apps gets an `admin_ask` notification with reason `connector` (the service in `latest.title`,
waiting), opening Settings › Connectors, since the conversation may be one they can't open. Nobody who may: the tool
refuses and the agent says so.

**Going on.** Whatever changes what an agent holds queues `connection.requests_check` (`queueConnectionCheck`, only
while a request waits): a connection made or signed in again (`storeConnection`, `storeCustomConnection`) and access
given (`setAgentScopes`, `setAgentAccess`, `grantScopes`). The job (`settleConnectionRequests`) marks each request
whose agent now holds a working connection of its service `connected` and:

- the run still waiting reads "X is connected now … carry on with the task: `next`" and resumes;
- a run that stopped waiting (a person wrote meanwhile: the wait takes messages, `holdsMessages`, `detachOf`) or ended
  gets a `wait_result` notice in its conversation with `next` and the original request, which joins its next run or
  starts one there (`deliverNoticeToRun`);
- a canceled run stays stopped.

The card then reads "Connected, continuing" (`resumed`), the asks are done.

**Expiry.** `connection.request_expired` at 24 hours (`CONNECTION_WAIT_MS`): checked once more, then `expired`; a run
still waiting reads that nobody connected it and tells the person in one line. A detached run hears nothing.

**Prompt and judge.** `HOW_YOU_WORK` says never to stop at "no access" for a connectable app; `turnMeans` and
`HAND_OVER_STEP` name `request_connection`; `find_tools`' missing connectors and `request_secret`'s connector check
point to it. The turn-end judge's `untried` covers a reply that says it lacks an app, or asks a person to connect
one, while `means` offers `request_connection` and `tried` has neither it nor `request_permission`.

**Apps.** Web (`ActionCard.tsx`) and phone (`OfferCard.tsx`) draw the same card: `connectAppState` in
`packages/client/src/lib/action-cards.ts` reads open, continuing (from the request, or from live data in the second
before the job runs), connected or expired. `action_card.updated` carries the change.

## Consequences

- One more paused-run kind (`WaitKind` `connection`) that, like a device wait, takes a person's messages.
- The match is by service, not by connection: any working connection of the service the agent holds settles it, also
  one connected from Settings rather than from the card.
- Mailboxes and databases are outside it (their own screens); a service with no one-click way here keeps the old
  answers (`offer_connect_app` by address, the browser).
- The other languages' strings for the new card lines and the push title are added in English and Portuguese; the rest
  follow the translation tools (ADR 0122). The push titles have all fourteen.
