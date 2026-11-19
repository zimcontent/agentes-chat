# doug-0037: The pace of a conversation with an agent

Status: accepted. This instance's own. 2026-11-19. Builds on ADR 0010 (realtime: a reply shows whole), ADR 0017
(summaries), ADR 0043 (tools on demand), ADR 0112 (a burst read as one request) and the "Automático" model.

## Context

Next to a chat app where every bot answers like a contact, a message to an agent here felt slow and heavy, even when the
agent's work took the same time. Reading the path from a person's message to the first thing they see showed where the
seconds went before the model was even called:

- the burst wait (ADR 0112) held every run started on a person's message for 1.2 s after it when they weren't typing;
- two judges sized every run before its first call, each up to 1.5 s: the tool groups (ADR 0043) and, for an agent on
  "Automático", the model and effort, also for "oi" and "valeu";
- in a thread longer than the context window, the summary of what didn't fit was written again, a model call of up to
  4,096 tokens, before every run, since the newest message is always newer than the summary;
- and through all of it the person saw "pensando…" and nothing from the agent until its whole answer.

The other app answers a request for work in about a second with a short line ("Deixa eu checar."), picked from a list
while a small classifier decides, and its next words are the result. Its prompt tells the bot to carry a task to its end
in the same turn, the request being the go-ahead for every step, and to answer about as long as the message.

## Decision

**What holds a run before its first call gets shorter.**

- The burst grace without typing is 500 ms (`TYPING_GRACE_MS`): long enough for the typing frame the apps send the
  moment a person starts their next message, so "oi" then "preciso de uma coisa" is still one request. Whatever comes
  later still reaches the run through its inbox, as any message mid-run does.
- Small talk (`isSmallTalk` in `quick-ack.ts`: a greeting, thanks, an ok, a laugh or emoji alone, with or without the
  agent's mention, never with a file) asks neither judge: the run lists the core tools and the groups kept from the run
  before (`source: "small_talk"`), and on "Automático" thinks with the small tier at low effort (`SMALL_TALK_CHOICE`).
- A long thread's summary, once one exists, is read as it is and rewritten beside the run (`refreshThreadSummary`, one
  rewrite per thread at a time in a process). What it misses is the newest messages, which the run reads whole. Only a
  thread's first summary is still waited for.

**An agent's first words come in about a second** (`quick-ack.ts`, `quickAck` in the executor's deps, on in the
server). On a new run started by a person's message, outside small talk, background work, long work and agents' own
DMs, a calibrated judge (Jev, `kind: "quick_ack"`, `calibrated: true`) is asked beside the run's start whether the
message asks for work: looking something up, using a tool, making or changing something, several steps. At 0.6 or
more within 1.2 s, the agent posts a line from a fixed list, in the person's app language (else what their message looks
like), never the line it said last. No model writes it and nothing waits for it: a judge that answers after the run's
first model call has started posts nothing, and one message that started several runs gets no line (two agents would
both say it).

The line is a message of the agent's run with `meta.ack.runId`:

- silent like an agent's sticker after its reply: no notification, no push, no thread assessment, and routed to nobody
  (`message.posted` skips it);
- the apps don't end the run's live line on it (`postedOnTheWay`), so "escrevendo…" stays until the answer;
- no turn in anyone's history (`toTurns` skips it): the run that posted it reads a per-turn note, "You already
  answered", with the line and that its next words are the result itself, never another acknowledgement.

**The prompt asks for the same pace.** "Finish what you start" says the request is the go-ahead for every step it needs,
so the agent never stops between them to ask whether to go on, and that a progress line says where the work stands and
is never a question. An answer is about as long as the message it answers, and has no em dash. Two rules that said
the same in other words were folded in, so a DM "oi" is the same size as before (48,635 characters, `turns-eval`).

## What this does not change

- A reply still shows whole, once (ADR 0010). Breaking it into short messages as each paragraph is done is a separate
  decision.
- The prompt was already split between what holds for the run (cached) and what each turn reads (`turn` blocks, "# This
  turn" on a computer), and the computer brains already stay warm between turns (20 minutes on Linux, where the runner
  reads free memory; 3 elsewhere).
- An agent with a fixed model keeps it for small talk: only "Automático" moves to the small tier.

## Consequences

- A request for work shows the agent's words within about a second of the judge's answer; a greeting is answered by a
  small model with no judge in the way.
- Every request for work outside small talk costs one more Jev call (`quick_ack`), recorded like the other judges.
- A second message sent more than 500 ms after the first, with no typing between, may find the first answer already on
  its way; it joins the run's inbox and is answered in the same run, after it.
