# doug-0020: Each server serves its own Terms of Use and Privacy Policy, as a draft legal edits

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0004 (configuration), ADR 0088 (deleting a
workspace and an account), ADR 0060 (telemetry) and ADR 0100 (voice messages).

## Context

DougBot is deployed as a service for each customer company, on a server of its own, and the company that runs it is
the one that answers for the data. Up to here the app served the upstream project's Cloud documents (`/terms`,
`/privacy`, in `packages/i18n/src/legal`), written for a company that is not the one deploying: its controller, its
sub-processors, its governing law. Every installation needs its own Terms of Use and Privacy Policy, in Portuguese
and English, matching what the code actually does, and a lawyer has to review them before a customer reads them.

The document's text is legal's to write. It must not require a code change to fix a sentence, nor a build from a
lawyer, and the company's own details (name, CNPJ, address, the data protection officer) must be filled in per
installation, not committed to a public repository.

## Decision

1. **The documents are Markdown in the repository** (`docs/legal/`: `termos.pt-BR.md`, `terms.en.md`,
   `privacidade.pt-BR.md`, `privacy.en.md`). Each opens with a `> [!warning] Draft` banner, so whoever reads it in the
   repository knows its state. The web app reads each as raw text (`?raw`), so an edit ships with the next build and no
   other change (`apps/web/src/legal/text.ts`).
2. **The company's fields are `{{placeholders}}`**, filled from the installation's `LEGAL_*` environment variables and
   served by `GET /api/app/legal` (`legalFacts` in `packages/engine/src/legal.ts`, read from the config by the route).
   A field the installation has no setting for reads `[a preencher]` / `[to be filled]`, which keeps the page a draft
   until someone fills it. None of the company's data is committed.
3. **The retention numbers come from the settings that enforce them**: the voice retention (`VOICE_RETENTION_DAYS`) and
   the backup retention (`LEGAL_BACKUP_RETENTION_DAYS`, which the operator keeps equal to the `backup` service's
   `BACKUP_RETENTION_DAYS`, since that service reads no app config). Changing a number changes both the behaviour and
   the document that describes it.
4. **The pages are the app's own**, public and without sign-in: `/termos` and `/privacidade` in Portuguese, `/terms`
   and `/privacy` in English, each with a language switch. Both servers default `TERMS_URL` and `PRIVACY_URL` to their
   own pages (an absolute address on `PUBLIC_URL`), so the sign-in and sign-up screens link them with no setting; a
   setting that names a page elsewhere still wins. The agentes.chat Cloud's own hosts keep their Cloud addresses.
5. **The Privacy Policy carries the controller/processor split and the DPA as annexes**: the customer company is the
   controller of workspace content, the provider is the processor of it and the controller of account and operation
   data, and Annex I is a short Data Processing Addendum. Annex II lists the optional sub-processors, each turned on
   by an environment variable, with what it receives and whether it is on in this installation. The page does not fill
   that table: the operator does, and it says so.
6. **`Configurações › Sua conta` links both documents** in a new tab, and the sign-in and sign-up screens keep their
   terms line (now always present, since every server has the pages).

## Consequences

- Legal edits `docs/legal/*.md`; the app must be rebuilt for a change to reach a reader (the text is bundled with the
  build, not read from disk at runtime, so a customer's install has no path to write it).
- A new optional service that processes personal data must be added to Annex II of both Privacy Policies by whoever
  ships it.
- The upstream project's `packages/i18n/src/legal` stays in the tree (its tests and the docs copy unchanged), but the
  DougBot app no longer serves it: `/terms`, `/privacy`, `/termos` and `/privacidade` are this instance's documents.
- The `[a preencher]` pages are a draft on purpose: an installation that never fills `LEGAL_*` keeps publishing a
  document visibly waiting for legal review, which is safer than one that silently names no one.

## Addendum 2026-11-18: after the review

The first draft promised more than the code did and changed servers already running. What it settled:

1. **The text says only what the installation does.** The documents carry `{{#if flag}}…{{else}}…{{/if}}` blocks and
   `{{on:flag}}` states, resolved in `apps/web/src/legal/text.ts` from `GET /api/app/legal`, which now also returns
   booleans: `draft`, `backup` (`S3_BACKUP_BUCKET`, new in the schema; the app only reads it), `storage` (S3, disk or
   database), `telemetryForced` and one switch per optional service (`services`: the platform model key, the Jev
   router, GIPHY, e-mail, support, media, speech, phone pushes direct or through the relay, Composio, embeddings,
   WhatsApp, error reports, billing, the Drive copy and the usage report). Never a key or an address. Annex II is the
   table of those switches, and §5 lists only the services that are on. A key the owner types into the Service's own
   settings is not seen by it; the Annex says so.
2. **The usage report is an opt-out, on by default** (`TELEMETRY=on`; always on at agentes.chat's own hosts), so its
   basis is legitimate interest (LGPD art. 7, IX), not consent, and the Policy says how to turn it off.
3. **Backups and retention.** The backup paragraph exists only with a backup bucket; it says the dump is the database
   only (a file bucket and the WhatsApp gateway's databases are outside it). A retention of 0 (`LEGAL_BACKUP_RETENTION_DAYS`,
   `VOICE_RETENTION_DAYS`) prints no number: the audio is "kept until deleted", the backup service's own default is named.
4. **Deletion.** `purgeWorkspace` queues `org.files.purge` (the workspace's `orgs/{id}/` and `org-logos/{id}/`) and an
   account's photos go by `user.files.purge`, so no code change was needed; a bucket the workspace brought stays its
   own. `keptFromDeletion` (suspension, a hold other than billing, the operator's legal hold) delays it, and the
   Policy says so.
5. **Nothing changes for a server already running.** `TERMS_URL` and `PRIVACY_URL` are `https` addresses again and
   default to `/termos` and `/privacidade` only on a server that sets `LEGAL_COMPANY_NAME`; with neither the sign-in
   screen links nothing, as before. `/terms` and `/privacy` keep their guard (`legalPage`): Cloud documents on
   agentes.chat, a redirect to an address of the server's own elsewhere, DougBot's documents only at the default
   `/termos` and `/privacidade`, otherwise "no page", as before.
6. **Draft banner** only with `LEGAL_DRAFT` (default true) or while a company field the documents need is unset.
7. **A company's own words are neutered** (no backtick, line break or table edge) and shown in a code span, and the
   DPO's e-mail is a `mailto:` link when it has the shape of an address.
8. **The waiting list** (public company form, with consent, e-mail confirmation, a delete button and
   `COMPANY_REQUESTS_RETENTION_DAYS`) has its own section, shown only where the server reports that retention.
9. The language switch moves between `/termos` and `/terms` (and the policy's pair), `lang` follows the document, and
   the page shows a skeleton until the details arrive.
