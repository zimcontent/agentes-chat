# doug-0022: every installation has its own approval portal, kept in its own database

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
   else the embedded one (`approvalPortalAdapters` in `apps/server/src/start.ts`). `Adapters.approvalPortalEmbedded`
   tells the rest which, so the client-managing routes and the clients' own page are wired only on the embedded portal.
   Neither set: the embedded portal is the default, so a fresh server has its Portal page out of the box. An address
   without its token is a setup mistake, not "no bridge": the server logs it and keeps the portal off, and never
   silently falls back to the embedded one, reading an operation's portal differently than the team expects.
3. **One workspace's.** The portal is one workspace's operation (ADR 9001 §18). `portalWorkspaceOf`
   (`packages/engine/src/approval-portal-clients.ts`) reads, in this order, the workspace holding the first
   `portal_clients` row, else the one whose watch already made a task of it (`issues.source` of type `portal`), else
   the installation's first workspace. `portalOrgId` (the embedded contract), `portalWorkspace`/`portalHere` (the
   watch) and `portalBelongsTo` read the same two sources in the same order, so a client made and a task the watch
   later makes never name different workspaces. `upsertPortalClient`, `makeClientLink`, `revokeClientLink`,
   `removePortalClient`, the tool and every route of `…/portal-clients*` call `portalBelongsTo`: another workspace on
   the same server answers `404 portal.off` on each, never gets a client or its link, and its agents get no portal
   tool.
4. **A client has its own link, and that link is the whole access.** The team adds a client (its name, its contacts,
   a colour) in Settings or with the `portal_clients` tool. Each client gets `<PUBLIC_URL>/p/<token>`, a token derived
   from the link's id and this server's `AGENTES_SECRET` (`portalClientToken`), so only its hash
   (`portal_client_links.token_hash`) is kept and the address can be shown again from the row. A new link revokes the
   old one; a revoked link answers nothing. **A link is only shown while its token still matches its hash**
   (`clientLinkUrl`): changing `AGENTES_SECRET` makes every old address open nothing, and the clients list reports it as
   `linkStale` ("make a new one"), never as a working link. The token is scoped to one client of one workspace:
   `portalClientOfToken`, and every file read through `clientPortalFile`, checks the token's client owns the post, so
   nothing of another client is ever reachable. Each open marks the link's `last_used_at`, at most once every five
   minutes (`PORTAL_LINK_TOUCH_MS`). A contact's `id` is made on the server (`contactOf`), never taken from the input.
   A save that leaves `contacts` out keeps them; only `contacts: []` empties them.
5. **The client's page is its own, out of the app's signed-in routes.** `/p/<token>` is a public page
   (`apps/web/src/routes/p.$token.tsx`, `pages/ClientPortalPage.tsx`), its data read from `/p/api/<token>`
   (`apps/server/src/routes/portal-public.ts`, mounted on the app itself, outside `/api/`). It lists what waits on the
   client and the history, shows the video, the pictures or the carousel with the caption, and has "Aprovar" and
   "Pedir ajuste" (a note, and on a video the second marked, and on a carousel the slide). It works on a phone first,
   in the client's own language (pt-BR or English, from the browser), with the kit's components and this instance's
   design. It is `/p/`, not `/portal/`, so a proxy that sends `/portal` to an outside portal keeps working. The root
   route answers only its `Outlet` under `/p`: the page asks for no session, no push listener and no desktop bridge.
   Each request counts against a limit of the caller's address; each answer is `no-store`. Opening the page marks what
   waits as `seen`, once. A decision's body is capped at 64 KiB before it is read (`PORTAL_DECIDE_BYTES`).
6. **A workspace closed to work closes its clients' page.** A suspended workspace, one being deleted or one on a hold
   (`workRefusal`, `standing.ts`) answers `404` on every `/p/api/…` route, as a link that names none does: the page is
   the workspace's, not a sign of life from it.
7. **The decision comes back the way the bridge's did.** A decision turns the post `approved` or `adjust_requested`
   and keeps the client's note (a second of a video, a slide, a point on the picture in `portal_post_notes`); the
   workspace's own watch (`portalTasksTick`, every 20 s) reads the change and carries it to the card's task, tells
   whoever has the post and starts an agent on a change, exactly as a post the bridge updated. A post takes one
   decision, whatever arrives at once: `clientDecision` turns the row with `UPDATE … WHERE status IN (sent, seen,
   adjusted) RETURNING` inside a transaction, and the note is inserted only when the row moved; the second decision
   finds no row and gets `portal.already_answered` (409). `portalTasksTick` skips a server with no client and no task
   of the portal (nothing to put in step).
8. **The client is told, once, and not too often.** A send (or a new version) enqueues the `portal.notify` job under
   the post and version (`portalNotifyPostKey`), and `announcePortalPost` (`packages/engine/src/portal-notices.ts`)
   keeps what went out in `portal_notices` (client, channel, contact, post, version, time), where every limit is read.
   A client is *fresh* on a post while the version waiting on it is past the last version recorded, so the same
   version never tells twice, a v2 after an adjustment tells again, and what one client gets inside an hour is one
   notice with every fresh post in `posts[]` (the email's list, the text's first line). No notice goes while the
   client's link isn't live (`skipped: "link"`). The e-mail (`portal_ready`, its own words in pt-BR and English) goes
   to every contact with an address. WhatsApp goes to every contact with a number, only from the number the workspace
   picked in Settings › Clientes do portal (`organization_settings.portal_notice_number`, `setPortalNoticeNumber`,
   `…/portal-notices`): with none, nothing goes by WhatsApp, and no personal number is ever used. A number starts no
   more conversations than the app itself allows (`whatsapp.new_chats_limit`, through `deliverWhatsAppText`).
9. **A file is read through the same token.** `GET /p/api/<token>/files/<fileId>` streams a post's file, whole or
   the part a `Range` asks for (`rangedResponse`), so a video plays and jumps on a phone; a file's bytes never change
   under its id, so the page may keep them for an hour. Its name goes in `Content-Disposition` as RFC 6266's two
   forms (`contentDisposition`): `filename*` with the name as UTF-8 percent-encoding, and a plain ASCII `filename` as
   the fallback, with control characters dropped, so a name with an emoji, CJK or a newline never breaks the header.
   A post's files count against the workspace's storage (`assertStorageRoom` in `keep`, and `storedBytes`).
10. **The team's own portal is an agent's too.** With the embedded portal the agents' tools gain `portal_clients`
    (`packages/engine/src/approval-portal.ts`): it lists the clients, or makes one with its contacts and answers its
    link, so the right hand or a social-media agent can set a client up when a person asks. It changes what the team
    keeps (`elsewhere` in the run policy), so a routine never reaches it. The person behind the run must hold
    `assign_work` to make a client or change one; listing asks only for a membership, and the links in the answer go
    only to someone who may manage the portal. The clients' own route gives the links in `links`, by client, on the
    same rule.
11. **What the log says.** Creating, changing and removing a client, and making and revoking a link, are audit rows
    (`portal.client_created`, `portal.client_updated`, `portal.client_removed`, `portal.link_made`,
    `portal.link_revoked`); so is a post marked posted and the number chosen for the notices.
12. **A post marked posted.** This server has no publishing service, so a person says a scheduled post went out:
    `markPublished(client, item, { at, postUrl })` on the contract (`POST …/items/{itemId}/published`) turns a
    `scheduled` post `published` with its date and, when the team wrote one, its address; any other status is refused.

## Consequences

- Every installation has a portal of its own, at `<PUBLIC_URL>/p/<token>`, with no service to run: a client's link is
  the whole of what the team sends it.
- The bridge is kept: an installation that already runs one keeps using it, unrun by any of this, and the
  client-managing routes are the embedded portal's alone (they answer `404 portal.off` on a bridge's). An address with
  no token is a logged setup mistake, never a silent switch to the embedded portal.
- Scheduling a released post is `scheduled` at once, since this server has no publishing service to hand it to
  (ADR 9001 §5 is a bridge's): the team publishes and marks it posted.
- The page loads nothing of the signed-in app, and nothing of the workspace but the client's name and logo reach it.
  A workspace closed to work closes it too.
- A bridge's clients live at that service; the embedded portal's live here, with their links, and leave with the
  workspace.
