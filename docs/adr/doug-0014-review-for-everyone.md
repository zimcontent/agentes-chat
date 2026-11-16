# doug-0014: every member of the workspace sees and decides every review

Status: accepted. This instance's own. 2026-11-16. Changes doug-0007 §2.

## Context

doug-0007 tied who reviews a piece to who reads the conversation it came from. A piece an agent made in a person's DM
with it (a carousel asked for in private, a video's next version) was then seen by that person alone: the workspace's
other owners and the rest of the team never found it in Revisão, though reviewing is the team's work, not one
person's.

## Decision

1. **Every member sees every review.** Revisão lists every review of the workspace for any member, and opening one,
   its versions, slides, notes and the player only ask for the workspace's membership (a blocked account or a
   suspended workspace sees none). The conversation a piece came from no longer matters for who sees it.
2. **Every member writes notes and decides.** A note's file goes to the review's conversation even for a member who
   doesn't read it (`reviewId` on `POST …/artifacts/files`, `placed` in `createFileArtifact`), and so does a version
   edited by hand. A file attached to any review's note is opened by every member (`attachedToReview` in
   `artifacts.ts`); the conversation's other files keep their own rule.
3. **The decision is still said in the review's conversation, as the person.** The agent's work, files and thread live
   there, so "Aprovar" or "Pedir ajustes" posts there as before. For a member who doesn't read that conversation, the
   workspace membership stands in for the conversation's (`postPersonMessage`'s `place`, given only by code): their
   message lands in it, the mention starts the agent's run behind them, and the people of that conversation see it.
   A review whose conversation was archived refuses the decision (`video_review.no_conversation`).

## Consequences

- A teammate's message can appear in a DM between another person and an agent: the decision on a review that started
  there. Nothing else posts into a conversation from outside it.
- What a member reads of a DM is only what the review shows (the piece, its brief, links and notes); the DM's other
  messages and files stay as private as before.
- The agent's answer to the decision is in the review's conversation; a decider who doesn't read it follows the next
  version in Revisão.
