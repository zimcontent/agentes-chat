# doug-0021: The lock screen: a live block's buttons, and an agent's work as a Live Activity

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0035 (the phone app and its pushes), 0113 (live
blocks), 0152 (the push relay), 0178 (iPhones straight to APNs) and 0084 (agents' status lines).

## Context

The phone's lock screen is where a person sees their day before they open anything. Two things were missing there:

- An agent's card that asks something ("Confirmo a call das 10h com a Connor?") arrived as a plain notification. To
  answer, the person had to unlock, open the app, find the card and press its button.
- Work sent to an agent ("revisa a Lâmina 21") left no trace once the app was closed: the person couldn't see whether it
  was still going, waiting on them, or done, without opening the conversation.

Agents' cards are live blocks (ADR 0113); their buttons are the block's `actions` part. Another change makes the
morning brief and the per-sector cards live blocks too, with every card's buttons in that same part, so the mapping
below covers them without knowing what they say.

## Decision

### 1. A live block's buttons on the notification

A push about a message (`agent_reply`, `dm`, `mention`, `thread_reply`) whose block has an `actions` part carries the
block's first two buttons that do something (`set`, `draw` or `say`), then "Abrir". The mapping from a block to the
notification's buttons is one function, `notificationButtonsOf` (`packages/engine/src/push-actions.ts`): the first
`actions` part, as the block shows now (a button hidden by its `when` is no button), depth first through rows and cards.

- **Ids, not words, in the data.** The push's data gets `blockId` and `blockVersion` (ids, as ADR 0035 §4 asks); each
  button's id is `block:<its key in the block>`; "Abrir" is `open`.
- **Words beside the data.** The buttons' words come in the push's own `actions` field, under a category named for those
  words (`doug.block.<hash>`): the same words make the same category.
- **iPhone.** An alert with buttons is `mutable-content`: the app's notification service extension
  (`apps/mobile/targets/notification-service`) registers the category from `actions` before the notification shows.
  A block's button asks for the phone unlocked first (`authenticationRequired`) and leaves the app closed; "Abrir"
  opens it. The extension keeps at most 24 block categories; the app's own (a device's buttons) stay.
- **Android.** The push is a data message with `categoryId` and `actions`. A category already registered shows its
  buttons at once; a new one is registered by the app's background task (expo-task-manager), which shows the
  notification again with them when it finds it shown without (never twice).
- **The relay.** The push relay (ADR 0152) passes the category, not the words: through it an iPhone shows the
  notification without the block's buttons. That is on purpose: the relay forwards ids and the visible text only.

### 2. A press runs on the server as a tap would

`POST /api/app/organizations/{orgId}/blocks/{artifactId}/press` with the version and the button's key runs the button
as the block shows it now, as the person, through the calls a tap in the block makes: `setBlockState`, `drawBlock`,
`replyToBlock`. The same checks hold: the person sees the conversation and may post there. A press may reach the app
twice (the response listener, then a later launch), so its `clientId` (`p:<notification>:<key>`) makes the message
once, as any resend.

The app sends it with the session it already has, before any screen: `startPushButtons` runs at launch (an iPhone
starts the app in the background for a button that doesn't open it; Android's background task gets the press). A
press that fails (offline, signed out, the block changed) leaves the notification where it was, to press again or open.
A press of a block's button never opens a screen.

### 3. An agent's work as a Live Activity

When a person sends work to an agent from the phone (a DM with an agent, or a message that mentions one; not one steered
into work already going, nor a GIF alone), the app asks the server for the run that message started
(`GET …/live-activities/start`) and, when there is one, starts a Live Activity: the agent's face (the identity's bot,
drawn by the app and left in the app group it already shares with its share extension), "ROSA · Lâmina 21" (the agent's
name, then the task's title or the first words of what was asked), a line and a progress bar. Its push token goes to the
server (`PUT …/live-activities`).

The server keeps one row per activity (`live_activities`, migration 0282). A worker tick every 5 seconds
(`syncLiveActivities`) reads each open activity's run as `runs.ts` has it and sends only what changed:

- `queued` (or held by its computer or plan): "você está esperando · na fila".
- `running`: "você está esperando · começando / trabalhando nisso / falta pouco", the bar from its model calls (it
  climbs fast, then slowly, and never reaches the end alone).
- `waiting_approval`, or `waiting_input` on the person: "esperando você", the bar amber, sent at priority 10.
- `done`, `failed`, `canceled`: an end push with the last words; it leaves at once after a quick answer (under 30 s),
  else after four minutes.

Updates go at priority 5 with a stale date 15 minutes out; ends and waits on the person at 10. An activity Apple says is
gone, one ended on the phone (the app says so), or one past Apple's eight hours is sent no more. The words are rendered
on the server in the phone's language, as push texts are (ADR 0035).

### 4. Only straight to Apple

Live Activities go only with the server's own APNs key (`APNS_KEY`, ADR 0178), through the same HTTP/2 connection and
provider token as its alerts (`apns-push-type: liveactivity`, topic `<bundle id>.push-type.liveactivity`). Through the
push relay, or with iPhone pushes off, there is no sender: `…/start` answers `available: false`, the app starts none,
and a token is refused (409 `live_activities_off`). Nothing about a run passes through the relay.

### 5. The extensions

Both extensions are added at `expo prebuild` by `@bacons/apple-targets` from `apps/mobile/targets/*`: `DougLive`
(a widget extension with ActivityKit, `<bundle>.live`) and `DougNotice` (a notification service extension,
`<bundle>.notice`). They are signed with the app's team (`ios.appleTeamId` from `APPLE_TEAM_ID`) and listed for EAS's
credentials beside the share extension, named apart from the app (two targets of one name made EAS sign the app with an
extension's profile). The app starts activities through a local Expo module (`apps/mobile/modules/live-activity`); the
activity's attributes are one Swift file kept in both places, and its content state matches the server's `LiveState`
field for field (a test holds both).

## Consequences

- A morning brief or a sector card can be answered from the lock screen, with the same permission checks as in the app.
- Work sent to an agent stays visible while the app is closed, and tells the person when it waits on them.
- A new iOS build is needed for either (the extensions, the module, the Info.plist key); older builds get the same pushes
  as before, with the block's ids they ignore.
- On a server that sends through the push relay, iPhones get neither the block's buttons nor Live Activities.
- An iPhone can't run a button with the app force-quit if the system won't start it in the background; the press then
  waits for the next launch, which sends it once (its `clientId`).
