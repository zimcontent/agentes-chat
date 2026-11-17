# 9004. The ronda: agents look at the operation on their own

- Status: Accepted (built: engine, server, the shared client and the web app; the phone app reads it in Rotinas)
- Date: 2026-11-15
- Numbering: 9001 and up are this distribution's own decisions, apart from the upstream sequence, so the two never take the same number.
- Extends: ADR 0053 (routines and unattended work), ADR 0131 (autonomy brakes), ADR 0120 (agents learn on their own)
- Extended by: ADR 9005 (the right hand: email, a ronda per person, the day's opening)
- Code: `packages/engine/src/ronda.ts` (`setRonda`, `getRonda`, `rondaGate`, `RONDA_PROMPT`, `RONDA_CRON`), `ronda-changes.ts` (`rondaChanges`, `rondaEvent`, `rondaEventText`, `isRondaTarget`), the gate in `routines.ts` (`fireClaimedRun`), the event in `context.ts`; server `apps/server/src/routes/app/agents.ts` (`GET`/`PUT …/agents/{agentId}/ronda`); client `useRonda`, `useSetRonda`, `RUN_CODES` (`ronda_nothing`, `ronda_quiet`); web `apps/web/src/pages/agent/RondaCard.tsx`

## Context

Every agent moves only when something wakes it: a message, a mention, a routine, a webhook, a notice. ADR 0120 already
made agents learn on their own (the background memory review that Hermes Agent popularized), and ADR 0131 lets them act
by default within their permissions. What was missing is the other half of an active agent: nobody asks, and it still
looks at how the operation is going and does something about it. A person who doesn't open the app for a day should
find the work moved, not waiting.

A routine that says "look at everything" would do it, at a price: a model run on every slot, mostly to find nothing.

## Decision

### 1. A ronda is a routine of the agent's, marked

Turning it on (agent settings, "Ronda": off, every day at 08:00, 08:00/13:00/18:00, every hour from 08:00 to 20:00, in
the person's time zone) makes one routine for the agent: target `{ type: "dm", ronda: true }`, report `when_new`, fixed
instructions (`RONDA_PROMPT`). It reuses everything a routine is (its own room, the background run, `hand_off` as the
only way to speak, its record, the ledger, the brakes, Rotinas to pause or read it). One per agent; switching it off keeps
the routine inactive with its history; instructions a person adds to it in Rotinas stay when its schedule changes.

Who turns it on (admins who manage agents, or the agent's owner) becomes its person: it reports in their DM with the
agent and reads only what they see.

### 2. What changed, in code

Before any model, `rondaChanges` reads stored data since the last ronda looked (`until` on that slot's event; 24 hours
for the first, never more than 7 days), as the ronda's person sees it:

- new messages from others in the channels the agent is in and the person reads, with the latest three of each;
- tasks created, done, past their due date, or stuck (an agent's, unmoved for 4 hours) during the window;
- runs that failed (the agent's own, and others' it may see);
- approvals the person may decide that went 12 hours without a decision;
- the agent's and the person's routines that failed.

Something already stuck or late before the window is not news. Nothing changed: the slot passes (`ronda_nothing`) at
no cost.

### 3. The judge decides whether it's worth a run

Something changed: the judge (`ronda_worth`, a Noul, Jev or the org's small model) reads the changes with the agent's
role and instructions and its last record, and the slot passes quietly below 0.5 (`ronda_quiet`). A failed or absent
judge lets the run start: a ronda that saw changes should not go silent because a cheap call failed. A person's
"Fazer uma ronda agora" skips the judge and runs even with nothing new.

The changes go on the slot as its event (`ronda.changes`) and reach the run inside the outside-content envelope:
people's words are data, never instructions.

### 4. The run

The agent reads what changed with its role in mind, checks the real sources, does what it can inside its permissions
(and the brakes of ADR 0131), hands other agents' work to them, and tells the person in one message only what is worth
their attention. Silence is a good ronda.

### 5. Its own model (addendum 2026-11-15)

A ronda runs often and mostly reads, so the agent's own brain (a large model, or a plan's limits) is costly for it.
Its target may carry `model`, an API model from the catalog (or a workspace endpoint's), chosen in the card as "Quem
pensa na ronda"; null is the agent's own AI. Its firing copies it into the brief (`RoutineBrief.model`), and
`withRondaModel` gives the run the agent with that model on the API brain, on the workspace's key of the model's
provider (`credentialId` null: the gateway's default for that provider), applied after the right hand's person's AI
so the ronda's choice wins. It is applied where a run's brain is decided: the executor, `resolveBrain` and
`agentAiState`. Only the ronda's own run; a run its report wakes thinks as the agent. Budget and usage stay the agent's.
A model whose provider has no key fails the run as any agent without a key would.

## Consequences

- An agent with a ronda acts on the operation without a person in the loop, within what a routine may already do.
- Most slots cost nothing (no change) or one cheap judgment (`ronda_quiet`), visible in Rotinas and on the card.
- Not in this decision: agents proposing their own routines when they see a request repeat, and a daily digest outside
  the app (WhatsApp or push) for a person who didn't open it. Both build on the ronda's record.
