# doug-0007: the number's agent in WhatsApp groups, when called

Status: accepted. This instance's own. Changes doug-0002, which kept the agent out of every group.

## Context

The number sits in groups with the people it works for. There it should behave like one more member: speak when
someone calls it, keep up with the talk while it goes on, and stop when the group goes quiet. Answering every
message of a group would be noise, and a member who must be called again for each message isn't one.

## Decision

**Called, it joins.** A group message from outside calls the agent when it mentions the number with an @ (by its
number or by its hidden id, `whatsapp_accounts.lid`, learned from what the number itself sends in a group), says
the agent's name or handle as a word of its own, or replies to a message the number sent.

**It stays while the talk goes on.** A call opens the conversation for the agent: `whatsapp_chats.agent_session_until`
is that message plus 30 minutes (`WHATSAPP_GROUP_SESSION_MINUTES`). Every message in the group while it is open,
the agent's own included, moves it forward. Each message from outside queues `whatsapp.agent_reply` as in a
one-to-one conversation, so several in a row still get one answer. Past the time, the agent waits to be called again;
it says no goodbye.

**It answers what is said to it.** In a group the model is told who said each line (the name the sender's phone
gives, or their number) and reads the latest 40 messages (`WHATSAPP_AGENT_HISTORY`, 40 for every conversation
now). It answers only what is addressed to it, and answers `wait` to talk between other people or to something
someone already answered.

**The rest of doug-0002 holds.** The number's switch and the conversation's own switch, the quiet time after a
person writes from the number, the handoff and the daily limits work in a group as in a one-to-one conversation.
Giving a group back to the agent answers nothing by itself: it waits to be called.

## Consequences

While a conversation is open, every burst of messages in the group costs one model call, even when the answer is
`wait`. A group that talks among itself for long after calling the agent costs more than a one-to-one
conversation; the 40 answers a day per conversation still bound what is sent.
