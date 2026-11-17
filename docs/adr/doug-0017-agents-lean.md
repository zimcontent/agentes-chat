# doug-0017: Lean agents: the agent's page, "Seu time agora" and the Painel de IA on the web, the phone and the desktop

Status: accepted. This instance's own. 2026-11-17. Builds on ADR 0137 (the right hand), ADR 0148 (Equipe), ADR 0155
(a new agent's checklist), ADR 0172 ("Esperando você") and doug-0003 (accounts standing in for each other). The web
is also what the Mac and Windows apps show in their window (ADR 0036), so this is their screen too.

## Context

The agents' area on the web grew one feature at a time. An agent's page opened on a cover, eight tabs and a fact
sheet: instructions, tools and access, memory, files, usage, activity, and Configurações with identity, who thinks,
budget, owner, who talks to it, channels, computer, reports-to, twins, rounds, brakes, media and the danger zone.
Equipe opened on a table of every agent. Changing an agent's AI meant finding "Quem pensa" inside Configurações, and
the AI accounts lived in Configurações › IA e uso.

Walking through the area as a first-time user and as a busy owner, three questions came first: what the team is doing
now, what one agent is doing and can do, and how to make an agent smarter or cheaper. Everything else is changed
rarely, and Doug, the right hand, can change it from the conversation (its proposal cards already do that). Of two
directions, keeping every screen and tidying it ("option A") or slimming the main screens down ("option B"), the owner
chose B, the same way on the phone and on the web, with nothing taken away from the web.

## Decision

1. **An agent's page opens lean.** `/org/:id/agents/:agentId` with no `tab` shows who it is (face, name, role), how it
   is now (its work's line or its face's word, "Sem IA", the usage queue), three actions (Ligar, Tarefas, Ajustes),
   a card with "Pode usar", "Este mês", "Responde a" and the AI it thinks with, a new agent's checklist and what
   waits on someone, and "Hoje" (its tasks of today). `pages/agent/Front.tsx`.
   - Ligar starts the same voice call as its conversation's call button (doug-0006); Tarefas opens the task manager
     filtered to it (`?agent=`); Ajustes opens the full page.
   - Each row of the card opens where it is changed: Pode usar the tools and access, Este mês its usage, Responde a
     Configurações › Identidade, the AI the Painel de IA.
2. **Ajustes is the full page, one click deeper.** Any `?tab=` (and a `?sec=` alone, as older links have it) opens
   the tabbed page as it was, with Configurações first and a way back to the agent's page on the cover. Its bar is
   Configurações, Instruções, Ferramentas e acesso, Memória and Atividade; Mais holds Visão geral (the old overview,
   unchanged), Arquivos and Uso. Nothing was removed: creating agents, instructions, budget, brakes, reports-to,
   repositories, archiving and deleting, memory and approvals are all there. The right hand keeps its own page, and a
   personal workspace keeps its own bar (ADR 0159).
3. **"Seu time agora" is the team's front.** Equipe (`/org/:id/team`) opens on it: the right hand on top, how many
   agents it coordinates, how many work and wait on you, a way to "Esperando você", and each agent with what it does
   now and its work's line (`components/team/TeamNow.tsx`), waiting on you first. The other views (Lista,
   Organograma, Mapa, Setores, Governança e uso) are tabs after it, in the address (`?view=`), no longer remembered
   in the browser, so the team always opens on what happens now.
4. **The Painel de IA is where an agent's AI is changed on purpose** (`/org/:id/ai`, `pages/AiPanelPage.tsx`). "Quem
   usa o quê" lists every agent with what it thinks with (its chip opens the full model picker) and "Trocar a IA",
   a dialog of three intents: Mais inteligente, Equilíbrio, Mais rápida e econômica (`components/ai/ChangeAiDialog.tsx`).
   Each intent shows the model one shared rule picks (`intentChoices` in `packages/client/src/lib/ai-panel.ts`, the
   phone's too): the model it runs now when it has that size, else that size where it thinks now, else on another of
   its accounts or keys, plans before keys and the emptiest first, never an account at its limit. Nothing changes
   before "Trocar para …", and the toast undoes it. "Mais opções" opens Quem pensa in Ajustes. Under it, the AI
   accounts as Configurações › IA e uso lists them, and the backup order (doug-0003). `?agent=` opens one agent's
   change at once.
5. **Every way in leads somewhere.** The sidebar's faces and rows, Ctrl+K, notifications and the chat open an agent's
   lean page; every link that named a tab or a section opens Ajustes there. Ctrl+K's "Trocar modelo" and the agent's
   AI row open the Painel de IA, which Ctrl+K also lists. The Mac app's "give this account to agents" opens the Painel
   de IA instead of Equipe. A notification that asks to pick another model (`plan_model_dropped`) keeps opening Quem
   pensa on its model screen, in Ajustes.

6. **The phone makes the same split.** Its agent's profile is the same lean page (face, what it is on, Ligar /
   Tarefas / Ajustes, Pode usar, Este mês, Responde a, Hoje, Conversar) and its agents tab is "Seu time agora". The
   rare setup screens (creating, editing or removing an agent, its Advanced, "Usar em outros agentes", importing) leave
   the phone: they open the agent's page on the web or Doug's conversation with the ask written, and their old routes
   redirect to the team or the agent's profile. Its AI accounts screen is its Painel de IA, with the same three
   intents in a sheet.
7. **The desktop app shows the web.** The Mac and Windows windows load the site (ADR 0036), so 1 to 5 are their
   screens too; the one place the app links in on its own, where an AI account is given to agents
   (`agentsPageUrl` in `apps/desktop/src/control/devices.ts`), opens the Painel de IA instead of Equipe.

## Consequences

- Old addresses keep working: `?tab=`, `?sec=`, `&brain=`, `?computer=1` and a conversation's `?agent=&agentTab=`.
  `?tab=overview` is now the old overview inside Ajustes; the agent's page itself has no tab.
- What "Hoje" shows follows Atividade's rule: only the agent's owner and admins see its runs.
- "Este mês" reads the plan's tightest window when the agent thinks on a plan and the budget otherwise (ADR 0063 §5).
- The web and the phone read one rule for the intents (`packages/client/src/lib/ai-panel.ts`, tested on its own), so
  "Mais inteligente" picks the same model on both.
- Not done here: a "Pausar o time" switch (the server has no team-wide pause today, only stopping running tasks) and a
  progress bar per task (runs report no progress). Both need the server first.
