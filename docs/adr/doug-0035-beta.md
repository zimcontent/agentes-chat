# doug-0035: The closed beta: one stack per tester, the house AI up to a cap, and the tester's own AI beside it

Status: accepted. This instance's own. 2026-11-19. Builds on ADR 0078 (early access), ADR 0056 §10, ADR 0073 and
doug-0030 to doug-0033.

## Context

agentes.chat opened its closed beta on its own Cloud: one server, sign-up by early-access links (ADR 0078), every
workspace with a computer the platform provisions (ADR 0056 §10) and the platform's own key behind its small judge
(ADR 0073), capped per workspace (`limitPlatformNanoUsd`). The agents themselves thought with the workspace's key or
the AI accounts on its computer.

This instance is sold as a service, one stack per company (deploy/swas). Its beta follows that: a tester is a client
like any other, with a stack of their own, made by the team, and enters by the owner link (`/owner#claim=`). No
sign-up and no shared server. A tester should talk to the Doug team in the first minute, before connecting anything,
and still be shown how to connect their own AI.

## Decision

1. **One stack per tester.** `doug-cliente novo` makes it, the Doug team inside comes from the onboarding (doug-0030),
   and the owner link goes to the tester by email (deploy/swas/BETA.md has the steps and the words).
2. **The house AI.** A stack may carry the team's Claude key (`PLATFORM_ANTHROPIC_API_KEY`), filled by `doug-cliente`
   from the machine's conf (`DOUG_CHAVE_DA_CASA`). Every workspace without a key of its own thinks with it.
3. **A cap per workspace.** `PLATFORM_AI_USD_PER_MONTH` (conf `DOUG_TETO_DA_CASA_USD`) is the platform cap of a
   workspace the operator set none for (`setPlatformCapDefault`); the operator's own cap still wins. The server's
   platform keys go through `cappedPlatformCredentials`: past the cap the workspace has no platform key, its agents
   read as having no AI (ADR 0061), and the apps ask it to connect its own, as with any workspace without one. The
   judge's cap (`platformCapJudge`) is unchanged.
4. **Both, in the onboarding.** The AI step stays what it is: with the house key the team already thinks, and the
   person may still connect a plan or a key of their own, which then takes over (the gateway prefers the workspace's
   own key to the platform's).

## Consequences

- The cost of the beta is bounded per tester and month; usage is recorded per workspace as before (`billedTo`
  `platform`) and the operator's feed hears 50% and 100% (`platform_ai.threshold`).
- The key lives in a root-only file (`doug-cliente.conf`, `.env` 600). Revoking it means changing the conf and each
  stack's `.env`, then `doug-atualizar-clientes`.
- A cap read is cached a minute per process, so a workspace may spend up to a minute of calls past it (as the judge's).
