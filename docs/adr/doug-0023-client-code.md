# doug-0023: One build, one client's face — `clients/<code>/` read at boot by `DOUG_CLIENT_CODE`

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0002 (editions and `AgentesModule`), 0004
(configuration), 0180 (the license the server process runs under).

## Context

DougBot is sold as a service: the team deploys it for each client company, each one its own Docker stack, the same
image, and the client's code (`064`) naming its customizations (the SWAS contract). Each client wants small changes:
its name in the apps, its own color, later a tool its operation doesn't use taken out, one of Team Doug's agents it
doesn't need left out, a line of its own in the onboarding.

A folder of client code is the easy part. The one that has to hold is this repository's first rule: **everything that
runs in the server process is public AGPL code** (ADR 0002 §5, ADR 0180). A client's folder may not become the private
place where behavior other clients don't get hides in wait — that is exactly the `ee/` this repository doesn't have.
So the client mechanism has to be a public folder, loaded from configuration, with the same extension point the Cloud
already uses, and a path from it back into the shared code.

## Decision

### 1. `DOUG_CLIENT_CODE`, and nothing without it

`DOUG_CLIENT_CODE` (three digits, `064`) is the one new variable (`packages/config/src/schema.ts`, `.env.example`
through `bun run docs:env`). At boot, before anything serves, `start.ts` reads `clients/<code>/` from the source it was
built from and passes what it finds to the app; with no code, or with a code and no folder, nothing changes except that
a code with no folder is a boot error (`ClientConfigError`), never a server that runs as if nobody had asked.

The folder is named for the code alone (`064`) or the code and its slug (`064-padaria-aurora`, the deploy's own shape);
two folders for one code are refused.

### 2. Two files: `config.json` and `client.ts`

- **`config.json`** holds every declarative override, in a shape the code checks (`packages/modules/src/clients.ts`,
  `clientConfigSchema`; strict, so a misspelled key is a boot error and never a silent no-op). Today it holds two:
  - `product.name`: what the apps call the product;
  - `product.accent` (`#rrggbb`): the color they highlight. It paints the highlighted words (`--accent-text`) and the
    focus ring (`--focus-color`), on both of the identity's stages (`#0a0a0a` and `#f4f6f2`), whatever theme the
    person is in. A color whose contrast against either stage is under 3:1 is refused at boot: black or white would
    leave the highlight unreadable in one of the two themes, and the ring invisible.

  The two overrides this ADR first sketched besides these — `features` (the sidebar's tools a client turns off),
  `teamAgentsHidden` (the handles of Team Doug's agents its apps leave out) and `onboarding.intro` (a line of the
  client's own) — are **not** in the schema: no screen reads them yet, and a setting the server holds and never honors
  is a lie in the config. The schema names them and refuses them, so a folder that declares one stops the boot with
  that key named, and each enters with the screen that applies it for every server (see §4).

  It is declarative on purpose: a client's name and color are data, and data is reviewed, diffed and tested.
- **`client.ts`** exports one `AgentesModule`, added to the modules the server resolves (adapters on top of the
  defaults, routes under `/api`, `onStart`). It is the same extension point ADR 0002 gave the Cloud, and its rule
  applies unchanged: nothing under `apps/` or `packages/` imports it (`bun run check:boundaries`).

### 3. The apps read the name and the color

`GET /api/instance` (public) and `GET /api/app/me` carry `client` with the name and color, nothing else. The apps hold
them in `packages/client/src/lib/client-custom.ts` (`ClientLook`, `clientLookOf`, `NO_CLIENT`) and use them where they
show the product:

- the signature (`Logo` on the web, `Assinatura` and the launch splash's label on the phone) and the tab's title,
  through `setClientProductName`, `brandName` and `subscribeBrand` in `@agenteschat/i18n/brand`: every string that
  names the product reads the client's from then on, and a signature on screen follows the name as it arrives
  (`useSyncExternalStore`, so no prop carries it down and no logo is left behind saying the build's);
- the highlight through `--client-accent` on `<html>`, which the app's own accent tokens fall back to
  (`packages/ui/src/styles/doug.css`), so a server with no client is byte-for-byte the green it was. It stands where
  the identity puts the green on the screen's own accents — the highlighted words (`--accent-text`) and the focus ring
  (`--focus-color`) — and never on the bots, whose color is their own. `data-client-accent` on `<html>` says the color
  is a client's, and only then does it reach a part of the page that themes itself (`[data-theme]` further down):
  without a client the attribute is absent and that part keeps the green of its own theme.

`ClientOverrides` holds exactly these two (`name`, `accent`), beside the code. Every helper is a no-op for a server
with no client, which is every other installation.

### 4. A customization that is good for everyone goes up into the shared code

This is the rule that keeps the folders honest. **A `clients/<code>/` folder may only extend, never change what the
product does for every client.** What it can do:

- **rename** (its name, its color) — the flags `config.json` declares, which the shared code reads and honors for
  every server, client or not;
- **add** through the module API (an adapter, a route, boot work), reaching the engine only through the interfaces
  `AgentesModule` and `ModuleContext` give.

A new override (switching a tool off, hiding an agent, an onboarding line) enters the schema **with the screen that
applies it**, and that screen is the shared one every server runs: the switch is a `config.json` key read by the
shared code, never a branch only a client's folder walks. When an override turns out to be useful beyond its one client
— a second client asks for the same color slot, the same hidden agent, the same feature switch — it is **promoted** the
same way: the behavior moves out of `clients/` into the shared code (a new `config.json` key read by the shared code, a
new engine capability), so every client gets it from the same build, and the client's folder keeps at most a line of
configuration. Nothing in `clients/` is ever the only place a behavior lives: a change nobody else can see is, by this
ADR, a bug in the mechanism.

That is also why the mechanism is only the module API and a small, checked `config.json`: a folder cannot smuggle a
fork of the product past review, because there is nothing in it that other clients' builds don't also run.

### 5. The example is tested

`clients/000-exemplo/` shows both declarative overrides (a name and a color) with a module that only has an `onStart`.
It is loaded by `packages/modules/test/clients.test.ts` and by `apps/server/test/client-code.test.ts`, which read it the
way `start.ts` does and call the real routes: the example is the specification, and a schema change that breaks it
breaks CI. The tests also hold the line §2 draws: a `config.json` with `features`, `teamAgentsHidden` or `onboarding`
is refused with that key named, and an accent under 3:1 on either stage (black, white) is refused.

## Consequences

- One image serves every client; the client is configuration (`DOUG_CLIENT_CODE`) plus a folder in the source, and the
  folder is public code under the same review as the rest.
- A code with no folder, a bad `config.json` or a `client.ts` that exports no module stops the boot with the file and
  the key named: a client is never half-applied.
- The clients workspace (`clients/package.json`, `clients/tsconfig.json`) exists so each folder resolves
  `@agenteschat/modules` and typechecks with the rest (`bun run typecheck`); `bun install` keeps it in the lockfile.
- A native package or bundle built without `clients/` says so at boot instead of running a client's build silently
  without its customizations.
- What a `client.ts` may do is exactly what a module may do, so the Cloud's own behavior and a client's are governed
  by one rule (ADR 0002 §5), and nothing private runs in this process.
- `bun run check:boundaries` is what keeps §4's inside: a `client.ts` under `clients/` may only import
  `@agenteschat/modules` (and the other public packages §4 allows), so a folder can extend through the module API and
  nothing else — never the engine's internals, a route it shouldn't reach, or a private package.
