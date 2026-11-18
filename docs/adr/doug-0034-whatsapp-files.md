# doug-0034: Files on a WhatsApp number, both ways

Status: accepted. This instance's own. 2026-11-18. Builds on doug-0001 (the numbers), doug-0002 (the number's agent)
and doug-0004 (the bridge, its voice messages and the members' conversations).

## Context

On WhatsApp people send pictures, stickers, videos, voice messages and documents as often as words. The number's agent
heard voice messages (doug-0004, addendum 2026-11-15) but read every other file as `[image]` or `[video]` and was told
it couldn't open files, so it said so: "I can't see pictures". A member who wrote to the agent from WhatsApp had the
same answer in their conversation with it, where the agent opens any file, because the file never reached it. And what
the agent sent back to WhatsApp was its words alone: a picture, a video or a PDF it made stayed in the app.

People expect the number to behave as the phone does: what they send is seen and heard, and a file asked for comes as a
file.

## Decision

**What the contact sends is understood once, before the agent answers** (`whatsapp/files.ts`, `seeWhatsAppFiles`).
Each picture, sticker, video and document they sent since the number last wrote is fetched through the gateway and
turned into words, stored on the message (`whatsapp_messages.seen`: null not looked at, empty nothing could be made of
it, never tried twice):

- a picture or a sticker: a model that sees says what it shows and every word in it (prices, names, numbers);
- a video: four frames spread over it (ffmpeg, the image has it) looked at in one go, and its sound heard by the speech
  engines that hear voice messages;
- a document: its own text (`readForModel`: text, Word, PowerPoint, spreadsheets), a PDF looked at.

The agent reads it beside the file's kind: `[image] tem dessa no M? (what it shows, looked at for you: …)`. Its system
prompt says files come opened, as on a phone, and never to say it can't see or hear them; only a file with nothing after
its kind couldn't be opened, and it asks for it again.

**Who looks.** The agent's own API model when it thinks with one (billed to it, as its answers are). An agent on a plan
answers through `brain.route`, which takes text alone: the workspace's small model looks instead (`smallModelFor`,
recorded as the workspace's `summary` use with the agent's id). The pictures go as an opened file's tool result, the one
way every provider adapter shows a picture, so no adapter changes. A model that doesn't see (an endpoint that leaves
pictures out) gives no words, and the file stays its kind alone. What it says is outside text: inside the
conversation's `untrustedBlock`, like the file.

**A member's files go to their conversation with the agent** (`relayToMember`, `keepWhatsAppFile`). Each file becomes a
Drive file of that member in their conversation with the agent and is attached to the relayed message, made once and
kept on the WhatsApp message (`whatsapp_messages.artifact_id`). The agent opens it as any file in the app
(`read_artifact`): a picture seen, a voice message or a video's sound heard, a document read. The message says it came
from WhatsApp and that what the agent attaches goes back there.

**The agent's files go back** (`mirrorAgentReply`, `sendWhatsAppArtifact`). Every file attached to its reply in that
conversation goes to WhatsApp as WhatsApp shows its type (`whatsappFileKind`): a picture, a video, an audio as a voice
message, anything else as a document; a written document or a table as its PDF. One file with a short reply goes with
the reply as its caption. A file that can't go (past 32 MB, refused) is said in a line.

**The workspace's agents too** (`whatsapp/tools.ts`). `whatsapp_read` names each file's message, `whatsapp_open_file`
opens one as `read_artifact` does (kept as a by-product file of the run, to send on or attach), and `whatsapp_send`
takes a Drive file besides text, with a person's approval as before.

**Any agent that opens a video sees it** (`fileForModel`): its frames and its sound's words, where ffmpeg is installed.
Before, no AI here watched videos.

## Consequences

- An answer to a picture or a video waits for one more model call (a few seconds), within the minutes the agent takes
  anyway (doug-0002).
- A workspace whose agent thinks on a plan and that has no key of a model that sees (nor the server's) gets no words for
  pictures: they read as their kind alone, as before, and the agent asks. Showing pictures to a plan through
  `brain.route` would need the runner to pass them to the CLI: a later decision.
- The number's own agent still sends no file of the business on its own (no tools, doug-0002): when someone needs one,
  it hands over. Voice notes and GIFs stay as they were.
- The columns are added at boot (`EXTRA_COLUMNS`), as the rest of WhatsApp's.
