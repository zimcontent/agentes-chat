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
