# doug-0010: the app icons are the Doug

Status: accepted. This instance's own. Changes how ADR 0179's icons are drawn; what a person picks, and where, stays.

## Context

ADR 0179 brought upstream's app icons: five ready ones and, on the phone, icons a person makes, all drawn from the
agent engine (the pixel agent on a night or day sky, in the agents' eight colors, with their eye styles, expressions
and accessories). This instance ships the Doug as its icon, so the phone's picker said the icon in use was "Night",
showed a blue pixel agent there, and every other pick replaced the Doug with upstream's agent.

## Decision

**Every app icon is drawn from the Doug, by the identity's drawer.** `apps/mobile/src/brand/doug-icons.js` builds each
icon as SVG from `dougbot-avatar.js` (pure ESM, no dependency): the phone draws the picker's previews with it, Bun
writes the committed files with it and the phone's build plugin, under Node, draws the made icons with it. The
shipped icon's files (`scripts/brand-assets.ts`) come from the same function, so the icon and its picks never drift.

**An icon is a ground, a color, a face and a pose.**
- Ground: `day`, his black head on a piece of glass of the color (the shipped icon, on green), or `night`, his head in
  glass of the color lighting a dark stage (the shipped icon's dark look).
- Color: the brand's green first, then the team's bots' colors (Kiara's yellow, Mark's orange, Rosa's pink, Chess's
  lilac, Junin's blue, Sony's cyan) and white.
- Face: only his eyes change. The drawer takes a look (`olhar`) besides its states: normal, happy, winking,
  surprised, unimpressed, sad, angry, looking aside, laughing and asleep. A state still decides the rest (asleep dims
  him); the look decides the eyes.
- Pose: facing, or big and leaning in from the bottom right corner.

He wears nothing: the Doug has no accessory, so the picker's accessory section is gone, and with it the rules that
kept a face and an accessory apart. That makes 2 × 8 × 10 × 2 = 320 icons, every one leaning or not.

**The ready icons keep upstream's ids** (`night`, `moon`, `sky`, `peekNight`, `peekSky`), so the phone's native side,
the desktop app and the web keep their lists; only their pictures and names change: Doug (the shipped one), Good night
(asleep on the stage), White, Peeking and Wink. `READY_ICONS` in `doug-icons.js` says which icon each is in iOS's light
and dark looks.

**Where the files come from.**
- `cd apps/mobile && bun scripts/app-icons.ts`: the ready icons' phone files (iOS light, dark, tinted; Android's
  layers and the icon before Android 8; previews) and the web's (`favicon.ico`, `apple-touch-icon.png`, `icon-512.png`,
  each ready icon's `.ico` and picture). A tab's icon is his head close up, upright, on its ground.
- `scripts/made-icons.mjs`: the made icons, at build time (never committed), in a few threads; the plugin keeps them
  in `node_modules/.cache/app-icons` while `made-icons.mjs`, `doug-icons.js` and `dougbot-avatar.js` stay the same.
  On Android a made icon shares its back layer with the icons of its ground and color, and its one-color layer with
  those of its face.
- `apps/desktop/scripts/icons.ts`: the Dock's (macOS's shape) and the windows' pictures of each ready icon. The
  bundle's master stays the Doug in his piece.
- Upstream's generator (`packages/ui/scripts/app-icons.mjs` and `app-icons/*`) is gone; `night-sky.png`, on which the
  web draws a workspace's agent picked as the icon, stays as it was.

## Consequences

- A change to the Doug's drawing reaches the icons by running `scripts/brand-assets.ts` and `scripts/app-icons.ts`
  again; `apps/mobile/test/app-icons.test.ts` fails while a committed picture is not the drawing's, and while the
  drawing, the plugin and `packages/client`'s lists name different parts.
- A phone that had picked one of upstream's made icons (`made-<sky>-<agent color>-<look>`) finds no such icon in the
  new build, and the app reads it as the shipped one. On iOS the home screen goes back to the shipped icon. On
  Android that pick had turned the shipped alias off and its own alias is gone, so the launcher has no entry for the
  app until one is picked again: whoever had a made icon on an Android build re-installs it or opens it from a
  notification and picks one. The ready icons keep their aliases, so their picks survive.
- When upstream changes ADR 0179's icons, its scenes don't come back: the files here are written only by these
  scripts (see SYNC-DOUG.md).
