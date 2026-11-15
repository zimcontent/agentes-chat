# doug-0005: a deploy restarts at a stopping point, never in the middle of an agent's turn

Status: accepted. This instance's own.

## Context

A deploy restarted two things at once, both in the middle of whatever the agents were doing.

- **The server.** On SIGTERM it gave runs 20 s (`RUN_DRAIN_MS`) and then cut them. Worse for the agents that think on a
  computer: when the server goes, the runner's socket drops, and a dropped socket aborts every request in flight there
  (`connection.ts`), the Claude Code or Codex turn included. The turn resumed later from its session, but what it was
  doing at that moment (a command, a model call) was lost and redone.
- **The runner.** The deploy reinstalled it every time and the installer restarted the service at once, killing the
  CLIs mid-turn, even when the runner's code hadn't changed (its bundle is the same bytes from one build to the next
  when its sources are).

With several deploys a day, an agent working for an hour was cut several times.

## Decision

**The deploy announces the restart, and waits for a stopping point.** A stopping point is between two turns: the
turn running ends on its own (its tools, its commands, its model call), and the next one doesn't start until after
the restart. Nothing is cut; the run goes on from where it stopped, on the new version.

### The server

- `SIGUSR2` starts a **restart hold** (`apps/server/src/restart-hold.ts`). From then on:
  - no long job (`LONG_JOB_KINDS`: agents' runs, routines, WhatsApp answers…) is claimed here (`holdLong` on the
    outbox pump); quick jobs (notifications, emails, pushes) go on, and so does the app: people keep chatting;
  - each run executing here stops at the top of its next turn (`yieldForRestart` in `executor.ts`), through the same
    path as a shutdown: checkpointed, its job handed back due at once without spending an attempt. The hold keeps this
    process from claiming it again; the next instance takes it on boot.
- `/api/health` says `restart: "waiting"` while a run or a long job still runs here, `"ready"` once none does, and
  stays 200 (the container stays healthy). The deploy swaps the server when it reads `ready`, or after its own limit.
- A hold nobody follows with a restart lets go by itself after 30 minutes (`RESTART_HOLD_MAX_MS`), so a deploy that
  died halfway never freezes the agents.

### The runner

- `SIGUSR2` to `agentes-runner start` (`restartWhenIdle` in `daemon.ts`): a new `brain.turn` is refused with the new
  code `restarting`; the turns, commands and file work already running finish; once none runs, it exits with 75
  (`RESTART_EXIT`), which its service restarts as the new version (systemd's `RestartPreventExitStatus` is 0, 2 and 3).
  Background tasks go on through the restart, as before (`KillMode=process`). After 30 minutes
  (`RESTART_IDLE_MAX_MS`) it restarts anyway: a turn still running then resumes from its session, as a drop does.
- `agentes-runner host` (a server's own computer) passes it to each organization's runner, starts none again, and exits
  with 75 once all stopped.
- The engine reads `restarting` as `runner_restarting` and waits as it does for room on a busy computer: quietly, with
  no note in the chat, asking again after 5 s (`RUNNER_RESTART_RETRY_MS`) or as soon as the computer is back. Unlike a
  busy computer it never stands in on the model brain: the wait is seconds, and switching what the agent thinks with
  for that would be the bigger change.
- `install.sh --when-idle` and `agentes-runner service install --when-idle` update a running service this way
  (`systemctl kill --signal=SIGUSR2 --kill-who=main`) instead of `systemctl restart`; a service that isn't running
  starts as before.

### The deploy

The deploy script is the server's own (outside this repository). Its order:

1. build the new image (nothing stops);
2. compare the runner bundle in the new image with the installed one;
3. announce the restart to the server and wait for `restart: "ready"` (at most 15 minutes);
4. swap the server (nothing long runs in it any more), wait for it to be healthy;
5. only when the runner changed: install it with `--when-idle`.

A deploy asked while another runs is queued, not dropped: the script runs again when it ends if `main` moved meanwhile.

## Consequences

- A deploy takes longer when an agent is in a long turn: up to the time that turn needs, bounded by the limits above.
  People don't see it: their messages land and the agents answer once the new server is up.
- A runner older than this treats SIGUSR2 as the end of the process: its service restarts it at once, as before.
  A server older than this does too: the deploy only announces the restart to a server that says it knows it.
- Several organizations on one host computer: one that finishes first waits offline for the others (seconds to
  minutes). Acceptable for one server's own computer; a restart per child would need the host to swap children one by
  one.
