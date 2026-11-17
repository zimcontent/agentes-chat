# doug-0019: Nothing goes to the client before the team approves it, and the approved file goes on the task

Status: accepted. This instance's own. 2026-11-17. Builds on ADR 9001 (approval portal), doug-0007 (video review),
doug-0010 (design review) and doug-0012 (an editor's delivery).

## Context

Review already sends what the team approves to the client's portal by code (doug-0010 §8, doug-0012 §6). But an
agent also has `send_for_approval`, and nothing tied it to Review: an agent could put a video or a carousel up for the
client while it was still "Para revisar", or without ever sending it for review. The team wants one rule: the client
only sees what the team approved.

The post's card at the portal (the task, ADR 9001 §11) also didn't hold the approved file: whoever opened the task
saw the brief and the comments, and had to find the video in Review.

## Decision

1. **`send_for_approval` takes only approved files.** Every file an agent names (and its cover, if any) must be a file
   of the newest version of a review that is approved: a video's file, a design piece's slides, or the cover the team
   approved on an approved video (`post.coverOk`). Anything else is refused before a byte is read, and the refusal
   names the reviews those files are waiting in (`review-gate.ts`, `reviewGate`). An older version of an approved
   review no longer counts once a newer one is sent.
2. **One exception, named:** a design piece approved as its page alone (no slides as pictures) is exported after the
   approval; the agent passes that review's `review_id` and the exported slides go up under it.
3. **What isn't gated:** the sends Review itself makes after "Aprovar" (they are the approval's own); a new version
   for a change the client asked (`send_new_version`, ADR 9001 §17 and doug-0012 §7, decided by the team); and a
   person's own send from the Portal page, which is a person's decision.
4. **The approved version goes on the task.** When a review is approved, its version's files are added to its post's
   card at the portal (the review's own card, or the card of the task it was sent from or whose conversation it came
   from), once, beside what the card already holds (`approvedOnCard`). A portal that is down leaves the approval as it
   is.

## Consequences

- An agent that made something for a client sends it for review first and waits; most approved pieces then reach the
  portal on their own.
- A file the agent re-uploads (a new id) is not the approved one: it must send the approved version's own files.
- The task (web and phone) shows the approved video or slides among its files.
