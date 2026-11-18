# doug-0020: every installation has its own approval portal, kept in its own database

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 9001 (approval portal) and doug-0012 (an editor's
delivery).

## Context

The approval portal (ADR 9001) is where a team's clients approve what it made for them: posts, reels and carousels. It
was reached through a bridge — a small HTTP service the installation runs next to a portal it hosts elsewhere
(`APPROVAL_PORTAL_URL`, `APPROVAL_PORTAL_TOKEN`). That external portal belongs to one installation's private setup and
cannot ship to every client of this distribution. Every installation should still have a portal of its own, served at
its own address, so a team can send a client a link and a client can approve with no account.

## Decision

1. **The same contract, kept here.** `ApprovalPortal` (`packages/adapters/src/approval-portal.ts`) is the contract: the
   board per client, the cards, the sends, a schedule's lists and labels, the clients' colours and logos. A second
   implementation, `createEmbeddedApprovalPortal` (`packages/engine/src/approval-portal-embedded.ts`), answers it from
   this server's own Postgres instead of another service. The tools (`send_for_approval`, `send_new_version`,
   `portal_board`, `portal_work`, `portal_card`, `portal_plan`), the board's page, the review's deliveries
   (doug-0012) and the client's notes (`bringClientNotes`) all read through the contract, so they work the same with
   either implementation.
2. **Which one is on.** The bridge when the installation set one (`APPROVAL_PORTAL_URL` and `APPROVAL_PORTAL_TOKEN`),
   else the embedded one (`apps/server/src/start.ts`). `Adapters.approvalPortalEmbedded` tells the rest which, so the
   client-managing routes and the clients' own page are wired only on the embedded portal. Neither configured and no
   `APPROVAL_PORTAL_URL`: the embedded portal is the default, so a fresh server has its Portal page out of the box.
3. **Everything in Postgres, with its `org_id`.** New tables (`packages/db/src/schema/portal.ts`, made by
   `EXTRA_COLUMNS` in `packages/db/src/client.ts`, outside the numbered migrations, as every table of this instance's
   own features): `portal_clients`, `portal_client_links`, `portal_posts`, `portal_post_files`, `portal_post_notes`,
   `portal_cards`, `portal_lists`, `portal_labels`, `portal_jobs`, `portal_uploads`. A post's files and a client's logo
   are in the platform's storage under `orgs/{orgId}/portal/`, beside the workspace's own keys. The portal is one
   workspace's, as the bridge's is (ADR 9001 §18): `portalOrgId` is the workspace holding its rows, else the
   installation's first.
4. **A client has its own link, and that link is the whole access.** The team adds a client (its name, its contacts,
   a colour) in Settings or with the `portal_clients` tool. Each client gets `<PUBLIC_URL>/portal/<token>`, a token
   derived from the link's id and this server's `AGENTES_SECRET` (`portalClientToken`), so only its hash
   (`portal_client_links.token_hash`) is kept and the address can be shown again from the row. A new link revokes the
   old one; a revoked link answers nothing. The token is scoped to one client of one workspace: `portalClientOfToken`,
   and every file read through `clientPortalFile`, checks the token's client owns the post, so nothing of another
   client is ever reachable.
5. **The client's page is its own, out of the app's signed-in routes.** `/portal/<token>` is a public page
   (`apps/web/src/routes/portal.$token.tsx`, `pages/ClientPortalPage.tsx`), its data read from `/portal/api/<token>`
   (`apps/server/src/routes/portal-public.ts`, mounted on the app itself, outside `/api/`). It lists what waits on the
   client and the history, shows the video, the pictures or the carousel with the caption, and has "Aprovar" and
   "Pedir ajuste" (a note, and on a video the second marked, and on a carousel the slide). It works on a phone first,
   in the client's own language (pt-BR or English, from the browser), with the kit's components and this instance's
   design. Each request counts against a limit of the caller's address; each answer is `no-store`. Opening the page
   marks what waits as `seen`, once.
6. **The decision comes back the way the bridge's did.** A decision turns the post `approved` or `adjust_requested`
   and keeps the client's note (a second of a video, a slide, a point on the picture in `portal_post_notes`); the
   workspace's own watch (`portalTasksTick`, every 20 s) reads the change and carries it to the card's task, tells
   whoever has the post and starts an agent on a change, exactly as a post the bridge updated.
7. **The client is told, once, and not too often.** A send enqueues the `portal.notify` job
   (`packages/engine/src/portal-notices.ts`), which queues the `portal_ready` email (`packages/engine/src/email.ts`,
   its own words in pt-BR and English) to every contact with an address, and sends a WhatsApp text from the
   workspace's connected number to every contact with a number, when it has one (`deliverWhatsAppText`). Limits, so a
   client is never flooded: the job's key tells a post and version once, a contact hears about the same post at most
   twice a day, and the email is one send per post, version and contact (`portal-notice:<post>:<version>:<contact>`).
8. **Which way it goes out.** The `portal_ready` email is the client's own share of the page, with the client's link,
   never the workspace's members: a client has no account. The WhatsApp text is a line or two with the same link, from
   a number the workspace already connected.
9. **A file is read through the same token.** `GET /portal/api/<token>/files/<fileId>` streams a post's file, whole or
   the part a `Range` asks for (`rangedResponse`), so a video plays and jumps on a phone; a file's bytes never change
   under its id, so the page may keep them for an hour.
10. **The team's own portal is an agent's too.** With the embedded portal the agents' tools gain `portal_clients`
    (`packages/engine/src/approval-portal.ts`): it lists the clients with their links, or makes one with its contacts
    and answers its link, so the right hand or a social-media agent can set a client up when a person asks. It changes
    what the team keeps (`elsewhere` in the run policy), so a routine never reaches it and a run a person is behind
    gets it, with the agent's approval rule as for any outside action.

## Consequences

- Every installation has a portal of its own, at its own address, with no service to run: a client's link is the whole
  of what the team sends it.
- The bridge is kept: an installation that already runs one keeps using it, and the client-managing routes are the
  embedded portal's alone (they answer `404 portal.off` on a bridge's).
- Scheduling a released post is `scheduled` at once, since this server has no publishing service to hand it to
  (ADR 9001 §5 is a bridge's): the team publishes and tells the post so.
- The page loads nothing of the signed-in app, and nothing of the workspace but the client's name and logo reach it.
- A bridge's clients live at that service; the embedded portal's live here, with their links, and leave with the
  workspace.
