# doug-0016: Doug pinned on Início, and the site's look on the phone

Status: accepted. This instance's own. 2026-11-17.

## Context

On the phone, the right hand (ADR 0137) was one row among the agents on Início, sorted by its latest message
(doug-0014). Its job is to coordinate the team, but nothing on the screen said so. The owner tried a home that opens
straight on a conversation with Doug, who talks first and asks for decisions one by one. He preferred to keep Início as
it is (the signature on top, the tools, the small cards, what waits on him, the lists and the tab bar) with Doug
pinned above it.

The phone's look had also drifted from dougbot.app. The site uses round buttons, a round glass plate for floating
controls, cards one step above the stage with a lit top line and a 1 px rim, and the lime's wash for the one thing that
is chosen. The phone had square plates, 12-point button corners and flat cards. Its quiet text (`#6B6B6B` on
`#0A0A0A`, 3.7:1) was below the 4.5:1 that small text needs.

## Decision

1. **Doug is pinned above the tools on Início** (`DougPinned`, `DougPinnedCard` in `apps/mobile/src/features/chats`).
   The card shows his face, "Coordenando N agentes" (distinct agents working now) or "Pronto quando você precisar",
   a greeting by name, and one line: how many decisions wait, or that everything is caught up. It has two actions:
   his conversation ("Ver as decisões" when some wait, "Conversar" otherwise) and "Ligar", the live voice call
   (doug-0006) in his conversation. Before the first conversation, "Ligar" opens it.
2. **One number for what waits.** The card counts what Pendentes' badge counts (`useWaitingCount`), so the two never
   disagree.
3. **His row leaves Agentes while he is pinned** (`withoutPinnedAgent`). The rest of the list keeps doug-0014's
   order. A workspace with only Doug shows Início with Doug, not the invitation to create the first agent.
4. **The site's surfaces, as pure values** (`apps/mobile/src/ui/surfaces.ts`): `panel` (cards and the lists' panels),
   `pill` (round floating controls: the tools' plates, the count's pill) and `chosen` (Doug pinned). Both themes
   have them. Início's lists sit in panels with compact rows (`ListRow compact`: a 44 face, the 15 name).
5. **Round buttons.** The kit's button is a pill (radius half its height), and the primary keeps the site's lime rim
   and glow.
6. **Quiet text at 4.6:1** on the dark stage (`#8A8A8A`, the site's `--db-texto-leve`). The identity's `#6B6B6B` stays
   for marks.

## Consequences

- Every screen that uses the kit's button, the quiet text color or `ListRow` changes look with this. The rest of the
  phone app moves to the same surfaces screen by screen.
- The board (`prancha-src/telas.tsx`, `/inicio`) draws the same card, tiles, glance cards and sections as the app, so
  a screenshot of the board is a check of the app's own parts.
- The kit's rule "pills only for labels you don't press" does not hold on this instance. Its buttons are round, as on
  the site.
