# doug-0021: Support under the account, for the installations a client buys

Status: accepted. This instance's own. 2026-11-18.

## Context

DougBot is sold as a service: a team deploys it for each company (one client code, its own Docker stack, its own
subdomain), and the company's people use it without ever meeting the team who runs it. When something breaks, they
have no way to reach that team from inside the app, and an agent that could help has no way to hand a problem over to
a person. `SUPPORT_EMAIL` already existed, but only for a workspace's hold notice and its computer's errors.

## Decision

1. **Support is the operator's, declared by env.** `SUPPORT_EMAIL` and a new `SUPPORT_WHATSAPP` are the two ways to
   reach whoever runs the installation; `DOUG_CLIENT_CODE` is the installation's own three-digit code. Support shows
   only when at least one address is set: a server that runs this code with neither set shows nothing. The addresses
   go out with the sign-in's options (`GET /auth-config`, which a signed-out page reads too); the code goes only to a
   signed-in person, with `GET /me`: the sign-in screen has no reason to say which client this is.
2. **One entry, in both apps.** The account menu and Settings › Support (web) and Você › Suporte (phone) show the
   address and the number as house-style links (a `mailto:`, a `wa.me` with digits only) and the client code, then
   "Peça ajuda ao Doug": the workspace's right hand in its DM, its box already holding the context (this server's
   version, the code, the page they came from) and the ask itself, in words, so the agent sends it with
   `contact_support` instead of only talking about it. The words come from each app's i18n: the draft reads in the
   person's language. The page is the one the person left for Support (the sidebar or Settings on the web, Você on the
   phone), not the Support page itself. The draft goes after whatever was already in that DM's box, and never in its
   place. Nothing in those facts is a secret; nothing is sent until the person writes and sends.
3. **An agent can send it, in the person's name.** `contact_support` is a built-in engine tool, listed only where
   `SUPPORT_EMAIL` is set. It carries the runner's `person`, so the person approves the card first, as
   `send_feedback` does (ADR 0160 §11): asking is the tool's job, so it asks at every level of "Aprovações", "Nunca
   perguntar" included. A run nobody is behind (a routine's, an agent's own) never sends it, and one person sends ten
   an hour at most. The email goes through the repo's own sender (`email.send`, `queueSupportEmail`), with the person's
   words readable and only made inert (their lines kept, no number masked), their address on `Reply-To` and drawn
   whole under From, and the workspace, the writing agent, the client code and the version as facts.
4. **The tool's classification is the table's.** `contact_support` is `elsewhere` in the run policy (it speaks for
   someone and leaves the workspace), refused to a routine and to a run a routine's reading feeds; the approval names
   only the person behind the run, as `send_feedback` names them.

## Consequences

- A server with neither `SUPPORT_EMAIL` nor `SUPPORT_WHATSAPP` is unchanged: no entry, no tool.
- The client code travels in the support email and shows in the app; it is not a secret and is not a licence key.
- A server with an address but no `SUPPORT_EMAIL` (WhatsApp only) shows the entry and no `contact_support`: the card
  says what it does (the agent writes it down with them), and promises no email to support.
- The email's words are English and pt-BR like every other (`supportRequest` in `email/words`); the person's own text
  keeps its lines and its numbers, and only what a mail client would link is broken.
