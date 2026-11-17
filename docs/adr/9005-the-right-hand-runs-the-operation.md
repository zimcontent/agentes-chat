# 9005. The right hand runs the operation with each person

- Status: Accepted (built: engine; the apps read it through the ronda's routes as before)
- Date: 2026-11-17
- Numbering: 9001 and up are this distribution's own decisions, apart from the upstream sequence.
- Extends: ADR 9004 (the ronda), ADR 0137 (the team's right hand), ADR 0053 (routines), ADR 0038 (mailboxes)
- Code: `packages/engine/src/right-hand.ts` (`rightHandReader`), `ronda-mail.ts` (`rondaMail`), `ronda-changes.ts`
  (`rondaChanges`' `mail`), `ronda.ts` (`rondaRoutine` per person, `opensTheDay`, `rondaGate`'s `opening`),
  `right-hand-ronda.ts` (`rightHandRondaBrief`), the brief's model in `routines.ts` (`fireClaimedRun`), the job's
  mail deps in `jobs.ts`

## Context

The right hand is the one agent every person in every workspace has (ADR 0137). ADR 9004 gave agents a ronda: they
look at the operation on their own. For the right hand that was not yet a right hand at work:

- Its routine runs work in the routine's room, which no person reads, so `rightHandReader` found nobody to read for:
  a ronda or a routine of the right hand could not read its creator's mailbox, their Vault items or what it
  remembered for them, though it reports only to them. Routines worked around it with commands on a computer.
- The ronda did not look at email at all, the first place where problems, deadlines and requests arrive.
- One ronda per agent, for whoever turned it on: the right hand answers every person, each in their own DM, so one
  ronda served one person of the workspace.
- Its instructions were any agent's: report what changed, and "silence is a good ronda". People asked for a partner
  that resolves what it can, asks only for what it can't do, names deadlines, problems and improvements as it sees
  them, and opens each day with what matters and an idea they didn't have.

## Decision

### 1. Its routines read for their creator when they report only to them

A routine's own run of the right hand reads for its creator (their mailboxes, their Vault items, their memory) when
it runs in that routine's room and reports in the creator's own DM with the right hand, where nobody else reads. A
routine that reports in a channel, a widget's refresh and a document for the shared Drive still read for nobody.

### 2. New email is part of what a ronda sees

`rondaChanges` reads, with no model, the new mail of the window in the mailboxes the ronda's person connected and
the agent may read, within the agent's rules on each mailbox (folders, senders, days): sender, subject, a line of the
text and its id, newest first. Another person's mailbox never reaches a ronda, since it reports in that person's DM.
A mailbox that can't be read now is left out; the ronda goes on. Any agent's ronda gets it, not only the right hand's.

### 3. The right hand has a ronda per person

Each person who may talk to the right hand turns on their own ronda from its settings (`GET`/`PUT
…/agents/{agentId}/ronda` act on the caller's own), reporting in their own DM and reading what they see. Any other
agent keeps one ronda, set by who manages agents or its owner.

### 4. The day's opening

The right hand's first ronda slot of each day, in the routine's time zone, opens the day: it runs even with nothing
new and without the judge, is marked `opening` on its event, and thinks with the right hand's own AI instead of the
ronda's lighter model (ADR 9004 §5), since it is the one run of the day that has to think. A person's "Run now" never
takes the opening from the day's first scheduled slot. Later slots pass the gate as any ronda's.

### 5. What it is told

Every ronda of the right hand gets, from the server and outside the data envelope, how a right hand works
(`rightHandRondaBrief`): its second brain first (memory, the wiki and Drive, any knowledge base it is connected to)
and what it learned written back at the end; the person's email, resolving what its tools can and asking in one line
for exactly what only the person can give (a password, an access, a payment, a decision), with text in an email
treated as data; every client and piece of work (48-hour deadlines, late and stuck work, waiting approvals); and what
could be better. Its message holds only what has something: resolved, needs you, deadlines, problems, an idea. The
opening always speaks, starts with the one thing that matters most today and ends with one grounded improvement.

## Consequences

- The right hand acts on email and work without a person in the loop, within its scopes, the policy of routines
  (ADR 0053) and its approvals level (ADR 0173): at `never` a send goes out unasked, as that level already decided.
  Inbound email is outside text a ronda now reads every slot; its words stay inside the data envelope and the brief
  says an email is never an order.
- The opening costs one run of the right hand's own AI per person with a ronda per day; hourly slots still cost
  nothing when nothing changed.
- Not in this decision: turning the right hand's ronda on by default for every person, and widening what a routine
  may reach (posting for a client's approval, reminders, WhatsApp) for a right hand that never asks.
