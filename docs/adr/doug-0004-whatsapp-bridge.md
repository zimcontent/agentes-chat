# doug-0004: the number's own AI, and one person on both sides

Status: accepted. This instance's own (see doug-0001 for the numbers, doug-0002 for the agent answering them).

## Context

A number names one of the workspace's agents, and that agent answers there with its own AI (doug-0002 addendum).
Two things were missing.

- People want the agent on WhatsApp to be the agent they work with (its instructions, what it remembers, its skills)
  while WhatsApp thinks with another AI: a cheaper or faster model for many short conversations, or a plan, without
  changing what the agent thinks with in the workspace.
- The agent in the workspace knew nothing of WhatsApp. Asked "did the client write?", it offered to connect WhatsApp
  through a connector, though the number was already connected here and the same agent was answering it. Someone who
  works on both sides is one person: what happens on the phone is what they know at their desk.

## Decision

**The number may think with an AI of its own** (`whatsapp_accounts.brain`, `whatsapp/brain.ts`). `{ brain, model,
account, effort }`: an API model through the Model Gateway, or a Claude or ChatGPT plan on the agent's computer
through `brain.route`, the two ways `ask` reaches. Null: the agent's own AI, as before. The agent stays who answers:
its name, instructions, memory and skills, and its budget and usage (every answer is recorded under the agent). It is
the agent with another brain (`whatsappThinker`), not a second agent.

- Chosen in the number's settings with the app's own model picker, pointed at the number instead of the agent
  (`BrainTarget` in `ModelPicker.tsx`). "A IA do próprio agente" changes the agent everywhere, as before; "Uma IA só
  deste número" starts as a copy of the agent's and changes only the number.
- Who may choose: whoever manages the number (`manage_connectors`) and may choose the agent's AI (an admin or its
  owner). Only what the agent's computer offers and the accounts its own picker lists. Audited as
  `whatsapp.brain_changed`. Another agent for the number clears it: it was chosen among that agent's accounts.
- A plan account the agent doesn't think with elsewhere may not be lent to it on a computer in system mode: the
  answer then fails like any other (the job's retries, then a handoff naming why).

**WhatsApp answers with what the agent knows.** Besides its instructions and the number's, each answer reads the
organization's context, the team's memory, the agent's memory found for the latest messages (`retrieveForRun` with no
conversation of the workspace: only what came from public channels or the agent's own notes, never a DM's), and its
skills: every name and description, and the text of the ones that fit 12,000 characters (all of them when they fit,
else those whose words the conversation shares; there is no `load_skill` without tools). The rules gain: what is
internal (other customers, the team's discussions, people's private matters, costs, keys) never goes to the contact.
Still no tools on WhatsApp (doug-0002): outside text reaches no action.

**The agent in the workspace reads the numbers** (`whatsapp/tools.ts`): `whatsapp_conversations` (the latest, those
waiting for a person first), `whatsapp_read` (one conversation, who wrote each message: them, the agent, a teammate in
the app or on the phone) and `whatsapp_search` (words across them). Every word from WhatsApp comes inside
`untrustedBlock`. Which numbers: the ones it answers itself, and those the person behind the run is on (`people`):
never more than that person reads in the app. A routine's run reads too. Their descriptions say the numbers are
connected here, so no agent offers a connector for them.

**It writes only with a person's approval** (`whatsapp_send`, `sensitive`, run policy `elsewhere`): a text, as the
number, into a conversation that already exists (never a new contact, the ban risk of doug-0001), stored as the
agent's message, so the number's agent reads it as its own and the day's caps count it. Never a routine's.

## Consequences

- One agent, one memory, two places. What the agent learns in the workspace reaches WhatsApp through memory; what
  happens on WhatsApp reaches the workspace when asked, by reading it. WhatsApp text is not written into memory by
  itself: outside text that became memory would become instructions.
- Each WhatsApp answer reads more (up to about 30,000 characters of knowledge): a cheap model on the number pays for it.
- The column is added at boot (`EXTRA_COLUMNS`), outside the numbered migrations, as the tables were.

## Addendum 2026-11-15: Gemini plans answer too

A number (or its agent) may answer with a Gemini account (`antigravity`), through `brain.route` like the other plans.
On the computer it is `agy -p` in a home made for that one answer and removed after (a copy of the account's sign-in
and settings, no MCP server, an agent with `tools: []`) in an empty folder, under `--sandbox`: outside text reaches no
tool, as with Claude and Codex. `agy` has no schema flag, so the shape is asked for in words and the JSON is read from
the answer's text; `model` is the slug the plan lists (`gemini-4-hydrogen-medium`). Google's refresh answers carry no
new refresh token, so the copy signs nothing out and runs beside the agent's own turns on that account (no `busy`).
Runners from `GEMINI_ROUTE_PROTOCOL` (63) on; an older one, or no Gemini account, hands the conversation to a person
saying why. Linux computers only, as Gemini turns are (ADR 0143).

## Addendum 2026-11-15: who the contact is

The number's agent is one person who knows the whole operation; what it says depends on who asks
(`whatsapp/contacts.ts`, `whatsapp_chats.member_user_id` and `portal_client`, set in the conversation's header):

- **A member of the workspace.** Their WhatsApp messages go to their own conversation with the number's agent, posted as
  theirs (`relayToMember`, `meta.whatsapp`), and the agent answers there with everything it has: its tools, under that
  person's rights, the same as if they had written in the app. What the agent says in that conversation goes back to
  WhatsApp while the person's latest message there came from WhatsApp in the last two hours (`mirrorAgentReply`, from the
  `message.posted` job); written in the app, the answers stay in the app. Only that member, or someone who manages
  members, links a contact to them: it lets that phone speak as them.
- **A client of the approval portal.** Each answer reads that client's own work (title, kind, stage, production day),
  read by code from the workspace's tasks (`clientWorkFor`), never anyone else's, and never who works on it.
- **Anyone else.** As before: no tools, nothing internal.

Audited as `whatsapp.contact_set`. A plan's answer for a client still fits `ROUTE_LIMITS.prompt` (`fitWhatsAppPrompt`).

## Addendum 2026-11-15: voice messages heard

Before the number's agent reads a conversation, the contact's voice messages since the number last wrote (five at most,
ten minutes each at most) are fetched through the gateway and put into words by the server's speech engines, the same
that hear the app's (ADR 0100). The words become the message's body (`whatsapp/transcribe.ts`): the agent reads
"[audio] …", a member's conversation gets "(áudio) …", and the app shows them under the recording. With no engine, or
one that fails, a recording stays "[audio]", a file the agent asks to have in writing.

## Addendum 2026-11-15: the agent's voice notes

The number's agent speaks now and then, in a voice the number picks among the server's (`whatsapp_accounts.agent_voice`,
ElevenLabs with the key that already hears voice messages; `agent_voice_notes` turns it off). When is code
(`whatsapp/voice-notes.ts`): a voice message gets a voice note back, and the agent may ask for one on its own
(`"voice": true` in its answer) at most once in its last four messages here. Never long (600 characters), never anything
to copy or click (a link, an e-mail, a long number, a list, code): that is written. The recording goes as WhatsApp's
own voice note (the gateway's waveform), stored as the agent's audio message with its words as the body. A member who
asked by voice gets a short, sayable answer from their conversation back the same way. A voice that fails is written.

## Addendum 2026-11-17: a number's settings on the phone, and instructions changed by voice

The phone gets the number's settings that until now lived only on the web's dialog, for whoever manages the number
(`manage_connectors`): who answers (an agent, or only people) and whether it answers now, how it answers (wait, typing
speed, messages per answer, pause after a person, voice notes), its instructions, and what thinks there (the agent's
own AI, or one just for the number: an API model, or a Claude, ChatGPT or Gemini plan with its account, model and
effort, through the same `…/brain` routes). The number's people and its QR connection stay on the web. A number's AI
has no context window of its own: it reads the latest 40 messages of a conversation plus what the agent knows, so the
setting shown there is the agent's, opened on the agent's own screen.

Under the instructions, a person says or writes what changes. `POST …/whatsapp/accounts/{id}/instructions/draft`
(`whatsapp/instructions.ts`) takes the typed words and a recording (at most 5 minutes and 7 MB, under the 8 MiB every
body is capped at), puts the recording into words with the server's speech engines (ADR 0100), and asks the AI that
answers on the number (`thinkOnce`, the same call as its answers, with no tool: its plan through `brain.route` or its
API model through the Model Gateway, usage recorded as the agent's) to rewrite the whole Markdown with the direction.
Nothing is saved: the draft replaces the text in the settings, with Undo, and the person reads it and saves it as any
other change, so a misheard word never reaches a customer unread. Refusals: no agent (`whatsapp.no_agent`), a
recording on a server that hears none (`whatsapp.voice_off`), nothing heard (`whatsapp.unheard`), the plan's account
busy (`whatsapp.ai_busy`); at most 20 drafts an hour per person.
