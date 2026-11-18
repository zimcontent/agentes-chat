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
already exists (early access), not a second one.

## Decision

1. **A list of its own.** `company_requests` (`packages/db/src/schema/company-requests.ts`, made by `EXTRA_COLUMNS`)
   holds one row per company's request, not one per address in a launch wave. It keeps the whole form: the person's
   name, email and WhatsApp, the company and its team-size band, what they want to automate (design, video, ads,
   social media, code, finance, each a code), a free field, the page's language, the consent (when it was given and for
   which notice), the team's own step (`new`, `talking`, `invited`, `deployed`, `discarded`), its notes, and the
   client's code (`064`) once the company becomes one. Sending the form again with the same address updates what the
   person typed; the team's step, notes and code stay.
2. **A consent is required, and it is the LGPD's.** The form's checkbox is a field of its own (`consent: true`); without
   it the request is refused (`consent_required`) and nothing is kept. The row stores when it was given and the
   version of the notice (`COMPANY_CONSENT_VERSION`), so a later change to what the form promises is told apart.
3. **The public form is this server's page, the same checks as the waiting list.** `POST /api/companies` and the page
   at `/empresas` ("Quero o DougBot na minha empresa"); a rate limit per address and in total, and Cloudflare
   Turnstile's bot check when the server has one, both wired as the waiting list's are (ADR 0075). A confirmation email
   goes out in the company's language, and a new request reaches the installation's owner's inbox and, where
   `COMPANY_REQUESTS_NOTIFY_EMAIL` is set, their email too; the confirmation asks nothing of the person.
4. **The team's list is the installation's pinned owner, on a self-hosted server.** Settings › Company requests reads it
   (`GET /api/app/companies`, one by id), moves its steps, saves notes, keeps the client's code, and invites through
   early access. Every route answers 404 to anyone else, and to agentes.chat's own servers, the way the GIPHY and Jev
   keys do (`pinnedOwner`, ADR 0073). `GET /api/app/auth-config` tells the apps whether the signed-in person is this
   owner (`companyRequests`), so the section is offered to them alone.
5. **The Invite is early access, not a second door.** "Convidar" calls `inviteEarlyAccess` for the one address, in the
   company's language, and moves the request to `invited` with who sent it. An address that already has an account is
   allowed at once (the account makes a workspace) instead of being sent a link; inviting again within the window sends
   nothing new. A server that sends no email refuses it (`early_access.no_email`).
6. **The client's code is the company's alone.** Three digits (`064`), set once the company is a client, which its
   deployment reads. Another company already holding it is refused (`client_code_taken`).

## Consequences

- The product's waiting list is untouched: the two lists answer different questions and one never stands for the other.
- A company the team turns down keeps its row (`discarded`), with its consent and date, which is what the LGPD asks of
  a record of what was collected and why.
- The confirmation and the owner's notice are both in the repo's emails (`company_request_received`,
  `company_request_owner`), in pt-BR and English; the other languages fall back to English, as every email does.
- The client's code lives on the request; the deployment side reads it from there when it installs the company. Wiring
  that last step is the installer's, not this list's.
