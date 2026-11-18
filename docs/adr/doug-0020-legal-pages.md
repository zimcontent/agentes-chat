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
