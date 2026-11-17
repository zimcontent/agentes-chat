# doug-0003: a person's second account thinks while the first is at its limit, and Gemini lists what its accounts offer

Status: accepted. This instance's own. Extends ADR 0041 (accounts per agent), ADR 0059 (AI accounts belong to
people) and ADR 0143 (Gemini plans through Google's Antigravity CLI).

## Context

An agent thinks with one account of its owner's plan on its computer (`agents.brain_account_id`). At that plan's
limit the run waits for the reset, or goes to an API key where one may think for it. A person with two accounts of
the same plan on the same computer (two Google AI Pro subscriptions, say) had to move agents between them by hand to
use the second one's quota.

Two things about Gemini made its plans hard to use here:

- The model picker listed what `agy models` said on the computer. The Antigravity CLI has no sign-in of its own
  there (ADR 0143 §3: always an account), and signed out it lists nothing, so the picker always showed the
  hand-copied `ANTIGRAVITY_MODELS`, which had only Gemini 4 Argon and Gemini 3.8 Flash, whatever the account's plan.
- Google's list moved: Gemini 4 Carbon (2026-11-10) and Gemini 4 Hydrogen (2026-11-12, with an Extra High level,
  `xhigh` in a slug) joined Argon (antigravity.google/docs/models, read 2026-11-14).

## Decision

1. **Stand-in accounts**, off unless the server sets `AI_ACCOUNT_STAND_IN` (`enableAccountStandIns`). While the
   agent's own account is at its plan's limit (this process's cache or the stored reading, `planLimitNow`),
   `brainAccountFor` answers with another account instead (`standInAccount`): signed in, on the same computer, of
   the same CLI and `provider` (so the same models), made by the same person and serving the same audience
   (`serves`), with room, the oldest first. It carries `standsInFor`. Every caller of `brainAccountFor` follows:
   the turn, the status pages, tasks. The agent's setting never changes, and it is asked on every turn, so its own
   account thinks again as soon as its limit resets. With every account full, the run waits on its own account, as
   before.
2. **A turn the plan refuses mid-run** (`plan_limit`, the account's own, never one model's) goes again at once on
   the stand-in (`standIn` in `executor.ts`): no wait, no note in the conversation, a `context` step
   (`accountStandIn`). A turn cut after it worked is told what it already did (`interruptedTurnPrompt`), as after a
   wait. The session id stays: the runner resumes a session only on the account it ran on, and starts it with the
   conversation otherwise.
3. **Not** for a mission's session (it stays where its work is), nor on a computer where each agent is its own OS
   user (`executors.mode: "system"`): there the computer tells each agent's worker the one account it thinks with.
   A signed-out account is never stood in for: signing in fixes that, not another plan.
4. **Gemini's models are the accounts' own.** The runner keeps what each signed-in Gemini account's status look
   (`agy models`, already run) listed (`AccountManager.agyModels`: each model once, the account that lists most
   first) and reports it as `hello.executors.antigravity.models` where the CLI listed none itself
   (`withAccountModels`); a list that changed goes out as `executors.changed`. No protocol change: the field
   existed. The fallback list (`ANTIGRAVITY_MODELS`) has Hydrogen (four levels), Argon and Carbon (three) and 3.8
   Flash; a slug ending in `-xhigh` names its level like the others (`antigravityBaseModel`, no `--effort` beside
   it).

## Consequences

- With two accounts of a plan, an agent keeps answering through the first one's limit, and usage is recorded on
  the account that thought (`usage_records.brain_account_id`).
- The picker's list is the union of the computer's Gemini accounts: a model there may be another account's plan's
  (Argon on a paid plan, Carbon on Ultra), and a turn on an account without it is refused by Google in its words.
- Google's FAQ says "automating account rotation" on consumer plans can end in suspension (ADR 0143, Context). That
  is why this is the operator's switch and off by default; Gemini Enterprise seats and API keys carry no such rule.

## Not done

- A switch per workspace or per agent, and a line under the reply saying which account answered.
- Waking runs already parked on the first account when a second one is added later: they go on at the reset, and
  new runs use the stand-in.
- Per-account model lists in the picker.

## Addendum 2026-11-14: backup accounts at 90%, in an order each person sets, of any brain

Agents stopped with a full account while the owner's other accounts had room: a stand-in came only at the plan's very
limit, only from the same CLI, and only with the server's switch, which stayed off. Long work had already paused at 95%
(ADR 0118) by then, so the second account was never reached.

1. **90%.** An account hands over from 90% of any window (`STAND_IN_AT`, the red of its bar, `PLAN_CRITICAL`) as well as
   at its limit (`handsOver`). `standInAccount` (same CLI, the server's switch) takes the first other account under 90%;
   with none and its own at its very limit, the first that still has any room, as before.
2. **The person's order** (`machine_accounts.stand_in_rank`, set by `PUT …/ai-accounts/stand-in-order`,
   `setStandInOrder`; only the accounts the caller connected; audited as `account.stand_in_order`). After the step
   above, `chainStandIn` (in `resolveBrain`) gives the turn to the first account of the order of the agent's own
   account's owner that is signed in on the same computer and under 90%, **of any brain**: the run's brain becomes that
   one's (`recordRunBrain`) and starts a session there with the conversation, as on a spill. In another brain's place
   ChatGPT runs GPT-6.1 Sol and Gemini runs Gemini 4 Hydrogen (`STAND_IN_MODELS`); in its own, the agent's model. The
   order is its owner's explicit choice, so it needs no server switch. Never for a mission's session, the right hand, a
   signed-out account, or where each agent is its own OS user.
3. **A run that parks** on a plan limit or the long-work pause while the order has an account with room goes on there in
   30 s, quietly (no note), instead of waiting for the reset; the runs behind it in its line follow.
4. With every account in the order past 90%, the agent's own account goes on to its limit, and then its API key where
   it has one and its fallback is on (ADR 0032), as before. The person sees and edits the order in Configurações › IA e
   uso › Contas reserva (`StandInOrderCard`).

The Google caution above stands for personal Gemini plans: an order is a person's choice for their own accounts.

## Addendum 2026-11-15: the right hand follows the order too

The right hand answers in groups, which it joins as any agent, and there thinks with the workspace's
account, not a person's. Left out of the order, it stopped at that account's limit with "o plano chegou ao limite" while
its owner's next account had room. Now the order covers it as any agent (`resolveBrain`, the status `agentAiState`, the
parked run's hand-over and the turn cut mid-work, which takes the next account of the same brain at once, `useStandInAccount`),
with one rule more: only an account that serves everyone, or the person it thinks for, stands in (`chainStandIn`'s
`answers`), so a plan kept to its owner never answers someone else through it.

## Addendum 2026-11-17: only a brain that locks stands in for the right hand

The right hand's turns are locked to our server's tools (ADR 0137 §4), and the runner stops one whose CLI offers tools
of its own (`tools_not_locked`). The Antigravity CLI from 1.5.9 lists all of its own tools in a locked turn whatever its
agent's `tools: []` says. On 2026-11-17 the right hand's Claude account passed 90%, its owner's order had Gemini next,
and every one of its turns stopped with "não ficou só nas ferramentas do DougBot" while the account after it had room.

- `chainStandIn` with `answers` (the right hand) skips the brains in `RIGHT_HAND_UNLOCKED` (Antigravity) and any brain
  whose CLI broke the lock on that computer in the last `UNLOCKED_MS` (6 hours, `noteUnlocked`, kept per process). Any
  other agent keeps its owner's order as it is.
- A right hand's turn stopped that way before it did anything goes on in the same run with the brain `resolveBrain`
  picks again (`useLockedStandIn`, once a run, `Transcript.lockedStandIn`), so a CLI that breaks the lock after an update
  costs one stopped turn, unseen, never a "Parei antes de responder". The person's own chosen brain is not replaced: its
  DM still says why it can't answer.
