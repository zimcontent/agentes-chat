# doug-0007: video review, notes on a video's seconds and the decision back to its agent

Status: accepted. This instance's own. 2026-11-14.

## Context

Agents edit videos for clients (shorts, testimonials, event videos) on the workspace's computer. Before a video goes to
the client, someone of the team watches it, often on a phone, and says what to change at which second, typing or
speaking. Until now that happened outside: a chat message with a file, notes in another app, the timecodes typed by
hand, and nothing kept the versions of one video together.

## Decision

1. **A review is one video and its versions.** An agent calls `send_for_review` with a video file it uploaded (an
   artifact) and a title. That opens a `video_reviews` row tied to the conversation the call came from (`channel_id`,
   `thread_id`), with version 1 in `video_review_versions`. The next version of the same video is the same call with
   `review_id`: the version number goes up and the review is in review again. Videos keep no versions in the Drive
   (`keepsVersions`), so the review holds them.
2. **Who reviews is who reads that conversation.** Every read and write checks `requireChannelAccess` on the review's
   conversation, so a review is as private as the place the agent worked in.
   Changed by doug-0014: every member of the workspace sees and decides every review.
3. **Notes are pinned to a version and a second** (`video_review_notes.at_ms`, null for the whole video). A note said
   aloud is transcribed at once with the speech chain (ADR 0100) and kept as its words, marked `voice`; the recording
   itself is not kept. Its author removes a note until it is sent.
4. **The decision goes back as a person's message.** "Aprovar" or "Pedir ajustes" posts, as the person who decided,
   in the review's conversation, a message that mentions the agent with every note of that version not yet sent,
   ordered by time (`[1:23] texto (autor)`), plus an optional word. The mention starts the agent's run like any other,
   with that person behind it. The notes are marked sent and stay read only. Asking for changes needs a note or a word.
5. **The review copy fits a conversation's file.** A file from the computer reaches the server whole, up to 50 MB
   (`heldFileBytes`). The agent uploads a review copy under that size (H.264, at most 1080 wide). The master stays on
   the computer for delivery.
6. **No realtime event of its own.** The apps read an open review again every 8 seconds and the list every 30, so a new
   version or another person's note shows up without a new event kind.
7. **Tables outside the numbered migrations.** Like this instance's other tables, `video_reviews`,
   `video_review_versions` and `video_review_notes` are created by `EXTRA_COLUMNS`, so the project's migration numbers
   stay free.

## Consequences

- `send_for_review` is a tool of runs in a conversation (`HERE` in the run policy). A routine's background run does not
  get it.
- The web app has Revisão (`/org/{id}/review`), in the dock while there is a review, with how many wait, and one
  video's page with the player, its notes and the decision. It is laid out for a phone first.
- Delivering an approved video to the client (Frame.io, the client's task) is the agent's next step after the approval
  message. It is not part of this decision.

## Addendum 2026-11-15: a light copy for phones

The review copies agents upload are 1080 wide at about 8 Mb/s (30 to 40 MB a short): over 4G, on the street, they
took long to start. Every version now gets a light copy made by the server in the background (job
`video_review.light`, ffmpeg in the image, `createFfmpegLightCopy`): H.264 with the long side at 960, about 1 Mb/s,
AAC, its index at the front, kept beside the file's bytes (`lightKey`) and gone with them. `video_review_versions.light_state`
says where it is (`pending`, `ready`, `none` when it came out no smaller, `failed`). The player reads
`GET …/video-reviews/{id}/versions/{version}/video` (in parts): the light copy once it's ready, the original before
that or with `?quality=original` ("HD" in the apps). A version sent before this gets its copy the first time it's
opened. The original stays as it is, for downloading and for the delivery after the approval. A server without ffmpeg
asks for nothing and plays the originals.

