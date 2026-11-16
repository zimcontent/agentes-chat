# doug-0014: the latest message first, and Início on the phone without a header of its own

Status: accepted. This instance's own. 2026-11-16.

## Context

People read the lists of agents and people the way they read WhatsApp: whoever wrote last is on top. Ours didn't do
that anywhere. On the web and the desktop app, AGENTES kept the workspace's order (`agentSort` `workspace`), and inside
a setor the order someone arranged it in. On the phone, Conversas went by the latest message, but pinned agents stayed
on top. Day one pins every agent the person made, and the first pin or unpin saved those as the person's own pins.
So an agent that wrote yesterday sat above one that wrote an hour ago, with no reason the person could see.

The phone's Início also started with a header that said little: the workspace's logo with the person's photo on it, the
DougBot signature (the logo again), a magnifier and "+", the large title "Início", a greeting ("Boa noite, Gabriel"),
then a field to message the right hand. The useful parts (the tools, what waits on the person, the conversations) came
below the fold.

## Decision

1. **Agents and people go by their latest message alone, on every app.** The phone's Conversas, its "Ver todos" and
   Agentes' Livres ignore agent and person pins. Inside a setor, Livres goes by the latest conversation too, not the
   setor's arranged order. The web's AGENTES gets a new order `recent` (`AGENT_SORTS`
   in `packages/engine/src/sidebar-items.ts`), first in its ⋯ menu and the default. It goes by each agent DM's last
   message, never talked to after, in the workspace's order. "Meus primeiro" and "Trabalhando primeiro" use it inside
   each part. The workspace's own order stays as `arranged` ("Do workspace").
2. **The old saved default reads as the new one.** Every saved view held `workspace` whether the person chose it or
   not (saving a pin saved the whole view), so `sidebarViewOf` reads `workspace` as `recent`, and the route still
   accepts it from an older app. Whoever wants the arranged order picks "Do workspace" again.
3. **A pin no longer moves an agent or a person.** On the web a pinned agent still becomes one of the big faces on top
   (up to four, after the right hand); past those, and in a setor, its row stays in its place with the pin's mark. A
   pinned person keeps their place in Mensagens diretas, marked. The phone's long press and swipe offer a pin only on a
   channel. Channels keep their pins and their arranged order: those lists are arranged by hand on purpose.
4. **Início on the phone has no header of its own.** The bar of every tab holds the DougBot signature alone: no
   workspace logo, no photo, no "+" (Ajustes opens the workspaces). Início has no large title, no greeting and no
   field for the right hand. The right hand is one of Agentes' rows, by its latest message, and before its first
   conversation a row to start one at the list's end. First come the tools: WhatsApp, Mídia, Buscar, Tarefas, and
   "Mais". "Mais" opens with "Novo agente" and "Nova conversa", then Threads, Drive, Agentes and the rest.
5. **Who waits on your reply comes before the lists.** "Esperando sua resposta" lists the agents whose work waits on
   the person (`AgentStatus.work.state` `you`): "Rosa espera sua resposta" or "…sua aprovação", how long, opening where
   it waits. It shows three and one row to Pendentes for the rest, and nothing when nobody waits. It replaces the line
   back to the right hand's first-run checklist, which the right hand's conversation still shows.
6. **The tab bar's names are one short word each.** Início, Pendentes, Portal, Revisão, Ajustes. The screens keep their
   full titles ("Esperando você", "Configurações").

## Consequences

- An agent moves to the top of its list or setor whenever it writes, as a chat does. Dragging an agent inside a setor
  holds only under "Do workspace". Dragging it into another setor works under any order.
- Someone who had picked "Do workspace" on purpose sees the latest message first once, and picks it again.
- The phone's Início scrolls straight to the work. Search is one tap from the tools, creating is in "Mais".
