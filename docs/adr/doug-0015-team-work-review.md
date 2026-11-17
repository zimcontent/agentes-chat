# doug-0015: Revisão by who made the work, and anyone of the team sends theirs from it

Status: accepted. This instance's own. 2026-11-16. Builds on doug-0007, doug-0010, doug-0012 and doug-0014.

## Context

Revisão started as the agents' videos (doug-0007), then their design pieces (doug-0010), then an editor's video sent
from a Portal task (doug-0012). Its tabs grew by kind: "Vídeo de IA", "Design", and a tab per editor that appeared only
once that person had sent something. Two things were missing for a team where people and agents both make work:

- The tabs mixed two questions, who made it and what it is. A design piece is also an agent's work, and a person's
  tab didn't exist until their first send, so the team couldn't see where an editor's work would go.
- A person could send only a video, and only from a Portal task, on the web. A designer who makes pieces by hand, a
  workspace with no Portal, or someone on their phone had no way in.

Nothing here is particular to one workspace: any workspace has agents' work and its people's work to review.

## Decision

1. **Revisão is organized by who made the work.** Its tabs are "Agentes" (what an agent sent) and "Equipe" (what a
   person of the team sent), both always there, and "Meus ajustes" (the changes asked of me) for whoever sent work
   themselves. Inside Equipe, a filter by person; inside any tab, Vídeos or Peças once it holds both, and "Para
   revisar" or "Todos". It opens on Meus ajustes while changes wait on me, else on the tab with work waiting. The rule
   is one module shared by the web and the phone (`packages/client/src/video-reviews/tabs.ts`).
2. **Any member sends their own work from Revisão.** "Mandar para revisão" takes a video (one file, up to 2 GB) or a
   design piece (1 to 60 pictures, its slides in order), a title, where the team talks about it (a group the person
   reads, or a task), and an optional word. The files are uploaded to that conversation first; then
   `POST …/video-reviews` (`sendPersonWork`, `packages/engine/src/person-reviews.ts`) opens a review like an agent's
   (`video_reviews`, `sender_user_id` the person, `medium`), and the person's line "Enviei a V1 de «…» para revisão"
   is said there. A video for a task keeps doug-0012's path (the post, the client, the final): the same endpoint hands
   it to `submitEditorVideo`.
3. **The next version comes from the review's page.** Only who sent the work sends its next version, of the same kind
   ("Mandar a V2"), uploaded into the review's conversation. It answers the open round of changes (doug-0012 §10).
4. **The decision comes back to the person, as for an editor** (`decidePersonVideo`): Aprovar or Pedir ajustes posts,
   as the person who decided, in the review's conversation, naming who sent it, with the notes (a piece's by slide,
   `[lâmina 2]`). No agent is started. Its next step says where to send the next version: the task's steps for a
   task's video, Revisão for the rest.
5. **A person's piece is its pictures.** It has no page to edit in place (doug-0010 §4 is the agents'), so its review
   shows the slides, the notes on them and the decision, without Comentar/Editar. An approved piece of a person is
   not delivered to a Portal client by code: whoever made it delivers it, as before.

## Consequences

- The phone gets the same tabs, "Mandar para revisão" with files from the phone's library, and "Mandar a V…".
- A person's design piece sent for a task carries the task (`task_id`) but isn't one of the task's videos
  (`taskReviewsOf` reads videos only), so a task's video steps never count it.
- PDF pieces are not taken yet: a deck goes as its slides exported as pictures.
