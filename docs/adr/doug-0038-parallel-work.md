# doug-0038: An agent works on two things at once in one conversation

Status: accepted. This instance's own. 2026-11-20. Builds on ADR 0008 (agent runs), ADR 0029 (a message mid-run goes to
the run's inbox), ADR 0112 and its addenda (the triage of a message sent while the agent works), ADR 0118 (sessions of a
computer brain) and the runner's one process per agent and session.

## Context

An agent at work on a long task ("deixa comigo") holds its conversation: one active run per agent and conversation, and
everything the person sends meanwhile goes to that run's inbox. The triage (`steerHandling`, ADR 0112 addendum) already
tells a correction, a stop, a quick question and a separate request apart. A separate request (`queue`) waited for the
task's end and only then got a run of its own; meanwhile the fast reply (`talker.ts`) said "I'll do it after".

The owner wants the agent to do more than one thing at a time: called while it works, it answers normally, and a new
request starts right away in a new session, beside the task. The pieces were there: the runner keeps one Claude Code
process per agent and session, and a turn gets its own process even while the others are busy; `sessionFor`
(`brains/select.ts`) never hands a run a session an active run uses, so a second run in the same conversation already
thinks in a fresh session. Only the routing kept it from happening.

## Decision

**A separate request to a long task starts beside it.** In `afterSteered` (`steering.ts`), when the triage says `queue`
and the run may have a sibling (`mayRunBeside` in `packages/engine/src/parallel-work.ts`), the message leaves the run's
inbox and starts a new run of the same agent in the same conversation (`startParallelRun`), whose trigger it is. That run
answers in the conversation like any other run (a DM's main timeline, or the thread), in its own computer session. No
fast reply speaks for it: it answers itself.

`mayRunBeside` is true only for a person's message, not sent with "Parar e mandar", into a conversation run that is
`running`, has called a tool (`runAtWork`: one that only talks folds the request into its answer, as before), has run at
least `PARALLEL_AFTER_MS` (60 s), is no background work or routine, and is not a mission's thread. Anything else keeps
today's way: the request waits for the task's end (`queueAfterRun`).

**Rules first, then the one judgment that already exists.** `parallelRule` keeps a message with the task without asking
anyone: "Parar e mandar", a quote of the task's own reply or request, two words or fewer, a short line that starts with
a stop, a go-on, a status question, thanks or a yes (Portuguese, English, Spanish), or one that points at the work
("nessa planilha, …"). What passes the rules is the triage's (`steer_triage`, the same judge call as before, recorded
the same way): only its `queue`, as sure as `STEER_SURE`, starts a run. The criterion of `queue` now reads "do this
apart from the task, which goes on". A judge that fails or isn't sure says `add`: the task reads it at its next pause, as
before. No second judge call is made.

**One message, one run.** The start is one transaction: the message leaves the task's inbox only while it is still
unread there and the task still `running` (status-guarded, like `queueOnRun`), the new run is inserted
(`startOrJoinRun` with `alongside`, which skips joining), and `meta.steeredRunIds` names the new run instead of the old
one, so receipts and the router read it as the new run's. If anything fails, it rolls back and the message stays where
it was. The sweeper, `releaseInbox` and every other inbox invariant are unchanged: each run still hands its own unread
messages on when it ends. The old run's trail gets a `context` step with `redispatchedMessageIds` and `reason:
"parallel"`; the apps hear `agent.run.redispatched` (the receipt moves to the new run) and `agent.thinking` for it.

**A cap.** At most `MAX_PARALLEL_RUNS` (3) active runs of one agent in one conversation, counted under an advisory lock
per agent and channel so two requests at once never pass it together. Past it, the request waits for the task's end.

**Each knows the other.** `alongsideHere` adds "# Also at work here" to every turn's context of a run with siblings: what
each other run works on, and not to redo it, answer for it or touch the same files at once.

**A message about the other task goes to it.** Several runs being active, a new message joins the newest, as already
happened with runs held by a decision. So a follow-up about the older task may land in the newer run. Two ways move it:
a quote of the other run's reply or request (`quotedRunId`, no judge), and the triage, which with siblings gets their
tasks too (`steerTriage`, keys `other_task_N` in the same one judgment). Moving (`moveToSibling`) is status-guarded the
same way, rewrites `steeredRunIds`, records `reason: "sibling"` and hands the message live to a computer brain mid-turn.

**The apps.** Live runs are already kept by run id (`packages/client/src/realtime/streams.ts`), so each run has its own
row in the conversation, with its own stop. The activity bar shows the agent once; its time, "Ver" and stop are a
single run's, so with two runs of one agent it leaves them out, as it does with several agents.

## Where one active run per conversation was assumed

- `startOrJoinRun` and `insertMessageWithRuns` already allowed several (held runs) and pick the newest: unchanged.
- `sessionFor` never shares an active run's session: the reason a parallel run gets a fresh one (tested in
  `engine-brains.test.ts`, "a conversation run never takes a session an active run … shares").
- `releaseInbox`/`handOn` of an ending run join the newest active one: unread messages of the run that ends go to its
  sibling, which reads the conversation anyway.
- `heldHere`, `whileHeld`: read runs by conversation and already handle several.
- A "stop" judged on the newest run stops that one only; the other has its own stop on its row and in the task manager.
- "Continuar" (`continue-run.ts`) still refuses while any run of the agent is active there (`run.agent_busy`): kept, a
  stopped reply goes on once the other work ends.
- The task manager, agent status and presence read runs by id or by agent: two runs show as two tasks, one presence.

## Consequences

- A long task no longer blocks a new request in the same conversation; the agent can hold up to three things at once.
- Two runs of one agent may compete for the same computer room and the same plan; the room line (ADR 0032) and the
  plan's limits apply to each as to any run.
- Every conversation run's context reads one more statement (`alongsideHere`), and the steering of a message sent
  mid-task one or two more (`siblingRuns`, `mayRunBeside`), after the send.
- Two runs may still step on the same files; the context line asks them not to, nothing enforces it.
