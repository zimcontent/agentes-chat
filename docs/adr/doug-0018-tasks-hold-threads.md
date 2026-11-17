# doug-0018: A task holds the thread it came from, and threads are no longer a place of their own

Status: accepted. This instance's own. 2026-11-17. Builds on ADR 0029 (threads and missions), 0121 (long work and the
Tasks board), 0128 (task manager) and 0145 (a task's conversation).

## Context

People couldn't tell what belongs in Tarefas and what belongs in Threads, nor why both exist. In the product there were
four things that looked alike:

- **Threads**: replies to a message, but the Threads page gave them a lifecycle (open, working, needs you, closed,
  archived), so it read as a second list of work.
- **Tarefas**: a card on the board, whose conversation was already a thread underneath, in a hidden channel of its own
  (ADR 0145).
- **Missões**: a thread with a plan, as a tab inside Threads (ADR 0029).
- **Background work**: the agent's work moved to a thread and also got a card on the board (ADR 0121), so the same work
  showed in both places with different states.

On top of that, "Gerenciador de tarefas" (ADR 0128) listed agents' runs, not tasks.

## Decision

A thread is where people talk. A task is the one thing that has an owner, a stage and an end. What has to be done is a
task, and a task talks in the conversation where the subject already is.

### 1. A task holds a thread

`issues.thread_channel_id` and `issues.thread_root_id` (migration 0281, unique on the root) point at an existing
thread of a channel or a DM. The task holds it without owning it: deleting the task leaves the thread, and the thread
stays read by its own conversation's readers. A task's own room (`conversation_channel_id`, ADR 0145) keeps its meaning
untouched: one hidden channel per task, deleted with it.

- Its conversation is its room when it has one, else the thread it holds (`taskConversationNow`). The board's line, the
  dialog's "Conversa" column, the unread rules of the room and `openTaskConversation` read it from there. Opening a held
  thread makes nothing.
- `linkTaskThread` refuses a reply (threads don't nest), a task room's root, a thread another task holds, and a task
  that already has a room or a thread.
- "Criar tarefa" on a message (`POST …/messages/{id}/issue`, `issueFromMessage`) holds the thread the message replies in,
  else the one it starts. Asked again from that thread, the server gives the same task back: one subject never becomes
  two tasks.
- An agent's background work (ADR 0121 §4) gets its card holding the work's thread (the anchor's own thread, else its
  home thread), so the work and its card are one place.
- Writing on the task (`commentIssue`, the agent's `comment_issue`) and "Pedir ao agente" (`askAgentToImplement`) go to
  the held thread when the writer is in that conversation (a member, or a person in a public channel), else to the
  task's room, made on first use. An agent is never let into a channel for a task: one outside it works in the room,
  as before. Working in the thread it came from, the "Took issue" line in the channel is left out: the start line is
  already there.
- A thread knows its task: `ThreadInfo.task` (`id`, `number`, `title`, `status`), for whoever sees that task, never in
  `thread.updated` events (it is per person). A run in a held thread gets the task's brief like one in its room
  (`context.ts`).

### 2. The apps

- **Threads leave the sidebar.** `threads` stays a known sidebar id (saved orders and the server's list keep it), but
  the apps never list it, in the sidebar, More, the tools' grid or Settings › General. `/threads` with no channel goes to
  Tarefas. A channel's "Threads (N)" still lists that channel's threads, with two tabs only (Todas, Arquivadas): no
  "Com trabalho", "Missões" or "Fechadas".
- **No "Fechar" on a thread.** Done is a task's state. A thread can still be archived (tidied away, read only).
  Threads closed before keep their state in the database and show like open ones.
- **"Tarefa #N" on a thread.** A thread a task holds shows the task's number in its header, with the task's stage as
  its icon, and opens the task over the conversation in place. A thread with no task offers "Criar tarefa com esta
  conversa" in its menu, and any message offers "Criar tarefa" in its menu: "Tarefa #12 criada. A conversa continua
  aqui e aparece na tarefa."
- **Missões live in Tarefas.** The board shows "2 missões em andamento · 1 esperando você" only while missions run,
  which opens them at `/issues?view=missions`. The sidebar's count of missions waiting on the person moves to Tarefas,
  after a mention's red count. Old links to `/threads?tab=missions` land there.
- **"Atividade dos agentes"** is the task manager's name (ADR 0128), and its rows say "trabalho", so "tarefa" means one
  thing in the product.

## Consequences

- One subject, one place: the task's dialog and the channel show the same conversation.
- A held thread's replies notify and count as unread the way a thread does (its followers), not the way a task's room
  does (the task's followers, ADR 0145 §4).
- A channel may hold several tasks' threads. Everything that reads a task's room by its channel
  (`conversation_channel_id`) is unchanged because a held thread never uses that column.
- Threads still exist as the chat's replies and as the channel's list; only their lifecycle and their page in the
  sidebar went away.

## Left out

- Missions keep their own model and cards (ADR 0029). Making a mission a task with a plan in the data is a later step.
- A task with no thread still opens a room on first use. Starting a new task's talk in a channel the person picks is
  a later step.
