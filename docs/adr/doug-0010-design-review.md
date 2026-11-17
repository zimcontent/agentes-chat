# doug-0010: design review, a piece's slides, notes on a point of a slide and edits by hand

Status: accepted. This instance's own. 2026-11-15.

## Context

A designer agent makes pieces for clients: a post, a carousel, a cover, a thumbnail. Each is drawn as an HTML page
and exported as pictures, one per slide. Until now the team reviewed them outside the app: a link to a page the agent
served from its own computer, with its own editor and its own notes, that nothing in the workspace knew about. A
reviewer often knows exactly what to fix ("move this glass down", "this title smaller", "swap this photo") and waits a
whole round for the agent to do it.

## Decision

1. **A design piece is a review like a video** (doug-0007): the same `video_reviews` row, with `medium = "design"`.
   Access, the list (Revisão), the card under the agent's message, notes said or typed with photos and links, and the
   decision that goes back to the agent as the person's message all stay one thing for both.
2. **A version is its slides and the page they were drawn from.** The agent calls `send_design_for_review` with
   `pages`, the slides as picture files in order, and `source_artifact_id`, the HTML file (`video_review_versions.pages`,
   `source_artifact_id`). The page must be self-contained: every photo, logo and font inlined as `data:` URLs. A page
   that loads anything by address is refused with the addresses named (`outsideReferences`), since the editor runs it
   with no network. The next version is the same call with `review_id`.
3. **Notes sit on a slide and a point of it** (`video_review_notes.page`, with the existing `x`, `y`), or on the whole
   piece. The decision message lists them by slide (`[lâmina 2] … [na lâmina: 80% da largura, 25% da altura]`) and
   names the version's HTML file. Design notes have their own kinds (`layout`, `image`, `type`) beside text, color and
   other.
4. **People edit the piece itself.** "Editar" opens the version's page in the editor: the agent's page in a frame
   sandboxed like every agent page (ADR 0019: opaque origin, no network), with a script put in first
   (`packages/client/src/lib/design-bridge.ts`) that shows one slide at a time, finds what can be edited (what the agent
   marked `data-layer`, otherwise the slide's pictures, texts and shapes) and does the editing: select one or several
   (Shift, or "Selecionar vários" on a phone), move with alignment guides, resize and rotate from the handles or with two
   fingers, rewrite a text in place, color, size, opacity, order, hide, swap and reframe a photo, undo and redo. Every
   change is the element's own inline style or content, so the page saved is the piece without a trace of the editor.
   The same script speaks to the web page by `postMessage` and to the phone app through its WebView channel.
5. **An edit is saved as the next version, made by the person** (`POST …/video-reviews/{id}/design`,
   `video_review_versions.edited_by`): the page is stored as their file in the review's conversation, the version has
   no pictures (`pages = []`, the apps show it live), and the notes they had not sent move to it. Only the newest version
   while in review can be edited; one that arrived meanwhile refuses the save (`video_review.stale_version`). The
   decision on an edited version tells the agent who edited it and that its page is the base from then on: on approval
   it renders the slides from that page before delivering.
6. **Pictures first, the page on demand.** Reviewing shows the slides' pictures (light, crisp, what the agent
   rendered); the page, which can weigh several megabytes with its photos inlined, is fetched only to edit or to show a
   version that has no pictures.
8. **What "Aprovar" does is the client's, set on its page in the Portal.** A piece is tied to the approval portal's
   client, and to the card it finishes, by the portal task the agent names (`task`, ADR 9001 §11) or by the client's id
   (`portal_client`). Each client has `after_approve` (`portal_client_settings`, in the client's menu beside its colour
   and logo, `assign_work` to change): `portal`, the default, sends the approved slides to the client's approval;
   `direct`, for a client whose approval is the team's own, sends them, marks the post approved and releases it for
   its card's day and hour. The send is code (`design-delivery.ts`, job `design_review.deliver`, the same upload and
   send as ADR 9001 §4, keyed by review and version so a retried job never sends twice), and what happened is said
   in the review's conversation by the workspace's assistant: sent to the client, scheduled for a day, approved with
   no day yet (the card has none), or why it didn't go. The decision message tells the agent the server delivers it;
   a version made by hand has no pictures, so then the agent renders and sends them with the portal's tools.
9. **Tables stay outside the numbered migrations**, like doug-0007's: the new columns are in `EXTRA_COLUMNS`.

## Consequences

- The same review screen serves the web, the desktop apps (they load the site) and a phone's browser; the phone app
  has its own screens on the same API and the same editor script.
- A designer agent's instructions need the step that inlines a piece's assets before sending it, and the marks
  (`data-layer`, `section.slide`) that make its layers editable by name.
- Rendering the final pictures stays on the agent's computer: the server does not run a browser.

## Addendum 2026-11-15: up to 60 slides

A piece may have up to 60 slides (`DESIGN_PAGES`), not 20. The client's sales decks (32 and 35 slides at 1920 x 1080) go through the same review as a carousel, so the team and the client can comment on any slide and edit the deck in place. The page's 40 MB cap (`DESIGN_SOURCE_BYTES`) still holds a deck of that size.

## Addendum 2026-11-17: `direct` approves and stops there

For a `direct` client the post is still sent and marked approved at the portal, but it is no longer released for its
card's day: nothing schedules a post but a person, by hand, at the Portal (ADR 9001, addendum 2026-11-17). The
conversation is told the post is ready and that the team schedules it.
