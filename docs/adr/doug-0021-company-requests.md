# doug-0021: Companies ask for DougBot on the page, and the installation's owner keeps their requests

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0078 (early access) and ADR 0180.

## Context

The product's waiting list (ADR 0078, `waitlist.ts`) is a row per email: the landing page there asks for one address
and the installation later invites it. This instance is sold as a service: the team installs Doug in each company,
one by one. The opening is by a waitlist and invitations, and the sale starts with a form only a company fills: who
they are, how many they are, and what they want the agents to do. The two lists answer different questions, and one
row per address is not enough to know where a company is (a new request, one being talked to, one already invited, one
that is now a client).

There is no sign-up for a company: the team reads each request and talks to it. The person running the installation
must see every request as it arrives, decide each one's next step, and send the invitation through the door that
already exists (early access), not a second one. The form exists on a self-hosted server alone: agentes.chat's own
servers are not where an installation is sold from, and the page and its route are not served there at all (ADR 0002).

## Decision

1. **A list of its own.** `company_requests` (`packages/db/src/schema/company-requests.ts`, made by `EXTRA_COLUMNS`)
   holds one row per company's request, not one per address in a launch wave. It keeps the whole form: the person's
   name, email and WhatsApp, the company and its team-size band, what they want to automate (design, video, ads,
   social media, code, finance, each a code), a free field, the page's language, the consent (when it was given and for
   which notice), the team's own step (`new`, `talking`, `invited`, `deployed`, `discarded`), its notes, and the
   client's code (`064`) once the company becomes one. A second form from the same address is kept apart until its own
   confirmation (point 3); the team's step, notes and code never move.
2. **A consent is required, and it is the LGPD's.** The form's checkbox is a field of its own (`consent: true`); without
   it the request is refused (`consent_required`) and nothing is kept. The row stores when it was given and the
   version of the notice (`COMPANY_CONSENT_VERSION`), so a later change to what the form promises is told apart. A
   second form never rewrites the first consent: what was given stays as it was.
3. **The request is confirmed by its address, and the owner hears of it only then.** A new request is `unconfirmed`,
   and the email it sends carries a link to `/empresas?confirm=<token>` (double opt-in, as the waiting list's
   `/api/waitlist/confirm`). The installation's owner's inbox row and, where `COMPANY_REQUESTS_NOTIFY_EMAIL` is set,
   their email go out once the link is opened, so an address that is not the sender's plants nothing. The list shows
   only confirmed requests. A second form from a confirmed address is held apart (its fields in `resend_data`, its own
   token) and replaces the request only once its own link is opened, which is recorded beside the original; a
   `discarded` request comes back `new` then, and the owner's notice reopens. The page's language is the app's own
   resolved one (`pt-BR`, `es`…); any tag it falls back from is taken (`en-US` reads English, `es-MX` Spanish), and an
   unknown one reads English, never a 400.
4. **The public form is this server's page, the same checks as the waiting list.** `POST /api/companies` and the page
   at `/empresas` ("Quero o DougBot na minha empresa"); a rate limit per address and in total, and Cloudflare
   Turnstile's bot check when the server has one, both wired as the waiting list's are (ADR 0075). The address is
   checked with `z.email()` on both sides, so `a,victim@x.com` and `a@b.co?cc=x` are refused by the form and by the
   server. Neither the route nor the page is registered on agentes.chat's own servers (`!isAgentesCloud`): there the
   form does not exist.
5. **The team's list is the installation's pinned owner, on a self-hosted server.** Settings › Company requests reads it
   (`GET /api/app/companies`, one by id), moves its steps, saves notes, keeps the client's code, deletes a request, and
   invites through early access. Moving a request on, or inviting it, resolves its notice in the owner's inbox
   (auto-resolve). Every route answers 404 to anyone else, and to agentes.chat's own servers, the way the GIPHY and Jev
   keys do (`pinnedOwner`, ADR 0073). `GET /api/app/auth-config` tells the apps whether the signed-in person is this
   owner (`companyRequests`), so the section is offered to them alone. The owner's notice and the team's list live in
   the owner's oldest workspace: the one `GET /auth-config` and the section open from.
6. **The Invite is early access, not a second door.** "Convidar" calls `inviteEarlyAccess` for the one address, in the
   company's language, and moves the request to `invited` with who sent it. An address that already has an account is
   allowed at once (the account makes a workspace) instead of being sent a link; inviting again within the window sends
   nothing new. A server that sends no email refuses it (`early_access.no_email`).
7. **The client's code is the company's alone.** Three digits (`064`), set once the company is a client, which its
   deployment reads. A unique index over the non-null codes holds it in the database, so two requests racing for the
   same code never both get it: the loser is a `409` (`client_code_taken`).
8. **The LGPD's erasure and retention.** `DELETE /api/app/companies/{id}` erases a request and everything it holds,
   the consent included, for a company that asks to be forgotten. A person deleting their account takes their own
   request with them (`deleteAccount` deletes by the account's address). A request the team never made a client or
   invited, and left alone for `COMPANY_REQUESTS_RETENTION_DAYS` (365 by default; 0 keeps it forever), is deleted by
   the worker: a record is kept only while the relation it stands for is real.

## Consequences

- The product's waiting list is untouched: the two lists answer different questions and one never stands for the other.
- The record of what was collected and why is the request, with its consent and date; it is deleted when the company
  asks, when the person's account goes, or once it sat untouched past its retention and never became a client. A
  guideline to the Privacy Policy page is in the report that goes with this change.
- The confirmation, the resend and the owner's notice are the repo's emails (`company_request_confirm`,
  `company_request_resend`, `company_request_owner`), in pt-BR and English; the other languages fall back to English,
  as every email does.
- The client's code lives on the request; the deployment side reads it from there when it installs the company. Wiring
  that last step is the installer's, not this list's.
