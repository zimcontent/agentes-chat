# doug-0041: What the Doug knows and does by default

Status: accepted. This instance's own. 2026-11-20. Builds on ADR 0037 (investigate first), ADR 0137 (the right hand),
ADR 0155 §6 (the first run), ADR 9004 (the ronda), ADR 9005 (the right hand runs the operation) and doug-0030 (the Doug
team).

## Context

People always put their own knowledge in a workspace: its context, the agents' instructions, skills, memory. Some of
the Doug's proactivity and know-how, though, has to be there before anyone writes a line, in every workspace, or a new
workspace meets an assistant that waits to be told how to work.

Reading what the right hand does by default against what only a configured workspace gives it:

| Behavior | Before | Where |
| --- | --- | --- |
| Look first, ask only for what is the person's, finish what it starts, a closed way is not the end, a teammate before "I can't" | every workspace | `HOW_YOU_WORK`, `finishWhatYouStart` in `context.ts` (every agent with tools) |
| Try at least two ways, switch the family of tool, deliver with proof, keep a recipe | only with the Doug team | the DOUG's role, `doug-team/agents/doug.md` |
| Its ronda, hourly, for everyone who used the workspace in 30 days | every workspace | `ensureRightHandRondas` (ADR 9005 §6) |
| The daily and weekly cards, approvals summary, reminders, team watch, welcome | every workspace, on until switched off | the lanes (`right-hand-lanes.ts`), `lodiSwitches`, `right-hand-prefs.ts` |
| Following the tasks it handed over | every workspace | `right-hand-follow.ts` |
| Following its own promises and follow-ups on the ronda | not said | `rightHandRondaBrief` |
| The morning summary, day close, Drive review routines | only with the Doug team, and paused | `doug-team/agents/doug.md` |
| House skills | only with the Doug team | `useDougTeam` |
| A first real task in the first minutes | nowhere: an owner got the checklist and, with no team, the team interview | ADR 0155 §6 |

## Decision

**Its way of resolving is the right hand's own, in every workspace.** `RIGHT_HAND_RESOLVE`
(`packages/engine/src/right-hand-defaults.ts`) is a block of its prompt on every turn, with or without a person behind
the run, whatever the workspace's context and instructions say: a plan in one line for work of more than two steps, two
different ways before saying no and a different family of tool each time (search, the page in a browser, a file or an
export, code on a computer, the teammate who holds the tool), a person asked only for what only they can give, the
result delivered with how it was checked, its own hand-offs and waits followed to their end, a short recipe kept after
something new, and a repeat offered once for a task the person does over and over. It is read live, so a workspace made
before it has it on its next turn, and it is not a switch: it is how the product's assistant works. A workspace's own
instructions for the right hand still follow it (ADR 0137 addendum).

**Its ronda follows its own work.** The right hand's ronda brief (`rightHandRondaBrief`) gains a step: the tasks it
opened or handed over, its follow-ups and what it said it would do, checked at their source, moved or closed, with the
result brought back with its proof. The ronda itself was already on by default (ADR 9005 §6) and stays as it is: its gate
in code and its judge keep a quiet hour free.

**Its know-how ships as a house skill.** `doug-team/skills/resolver/SKILL.md`: how to take a request to its end, try
another way, check, report, keep the recipe and offer the repeat, generic, with no client's data (the leak test holds it
like the rest of the material). Every right hand gets it once, as a team skill of the workspace turned on for it:
`giveRightHandSkills` as the onboarding ends (`saveOnboarding`), and `ensureRightHandSkills` on the workers' hourly
right hand tick for the ones made before. A workspace that already has a team skill of that name, live or deleted, is
left alone: deleting it is the workspace's choice and it never comes back.

**The first five minutes end with a solved task.** When an owner's onboarding ends, the workspace opens on the right
hand's DM, and the right hand asks there, once, for one boring task they do every week (`right_hand.first_task`,
`postFirstTask` in `right-hand-welcome.ts`, `chat.body.first_task_ask`, no model call, no ring since they are on their
way into it). For three days after the ask, `firstTaskBlock` tells it to do the task they name right there, itself, with
no agent, team or setup first and at most one question; to deliver the result with its proof, offering the one missing
connection after it; and then to offer once, with `offer_answers`, to repeat it as a routine at the time that fits, made
with `create_routine` on a yes. Someone who joins later keeps the greeting about their area (they are asked once, not
twice), and a task they hand over is done before their agent is proposed. The workspace's "Dar boas-vindas a quem
entra" switch turns the ask and its block off, as it does the greeting.

**Nothing that leaves the workspace goes on by itself.** No routine is made without the person's yes, the Doug team's
routines stay paused, and every send, payment or publish keeps its approval.

## Consequences

- Every workspace's right hand reads one more block per turn (about 1,600 characters), the same text everywhere, so it
  shares its cache prefix.
- A workspace sees one more skill, `resolver`, in Settings › Skills, which it may change or delete like any other.
- The owner's DM opens with a question instead of only the checklist; the team interview and the checklist's rows come
  after the first task, as "Raise only the first that fits, once what they asked is done" already orders them.
- The ask is not repeated when the onboarding ends again, nor posted to a workspace whose right hand may not act.
