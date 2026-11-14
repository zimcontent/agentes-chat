# doug-0002: the number's agent answers its WhatsApp conversations

Status: accepted. This instance's own (see doug-0001 for the numbers themselves).

## Context

A WhatsApp number can name one of the workspace's agents (doug-0001). People want that agent to answer the
number's conversations, on some numbers and not on others, and to step aside when a person takes one. Whoever
writes to the number is outside the workspace, and a number that behaves like a machine gets banned.

## Decision

**One switch per number, one per conversation.** `whatsapp_accounts.agent_on` turns the chosen agent on for the
number (`manage_connectors`). In a conversation, any of the number's people turns it off (`whatsapp_chats.agent_off`)
or gives the conversation back to it.

**It only answers.** A message from outside queues job `whatsapp.agent_reply` 8 to 13 seconds later. The job
answers only if that message is still the conversation's latest, so several messages in a row get one answer, and
nothing is ever sent to someone who didn't write. Never a group, never a message WhatsApp kept from more than ten
minutes ago.

**A person comes first.** When a person writes in a conversation, in the app or on the phone itself
(`whatsapp_chats.person_at`), the agent says nothing there for an hour. Before anything is sent the conversation
is read again: a person who answered meanwhile, or a new message, stops that answer.

**It hands over.** The model answers with one of three actions: `reply`, `wait` (nothing to answer) or `handoff`.
A handoff marks the conversation (`needs_person`, with the agent's one-line note) and the agent stays out until a
person gives it back. The same happens when its AI account doesn't answer after the job's retries, and past 40
answers a day in one conversation or 500 on one number (two machines answering each other stop there).

**No tools.** What the agent reads is outside text. It gets the agent's instructions, the number's own
instructions and the latest 30 messages (inside `untrustedBlock`), and returns text. It can't open a file, call a
connector or act anywhere, so the most a message can make it do is write another message. This is a model call of
its own, not an agent run: an agent run carries the agent's tools and scopes, which nobody outside the workspace
should be able to reach.

**It thinks with the agent's own AI account.** An agent on an API model answers through the Model Gateway
(budget and usage as any call of that agent). An agent on a Claude or ChatGPT plan answers on its computer through
`brain.route` (every tool off, nothing of its folder loaded), recorded on the plan. `brain.route` gains an
optional `model` so Claude answers with the model the agent uses; a runner that doesn't know the field answers
with its smallest. A plan busy with the agent's other work answers `busy` and the job tries again.

**Like a person on a phone.** Before answering, the messages are marked read; each message is preceded by
"typing…" for a time that grows with its length (1.5 to 7 s); at most three short messages.

## Consequences

- An answer takes 10 to 40 seconds. That is the point.
- The agent can't see pictures or hear audio: it asks for words or hands over.
- A workspace that wants the agent to act for a customer (book, look something up) doesn't get it here. That would
  mean tools reachable from outside text, and needs its own decision.
- The columns are added at boot (`EXTRA_COLUMNS`), outside the numbered migrations, as the tables were.
