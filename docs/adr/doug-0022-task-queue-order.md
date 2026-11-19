# doug-0022: Each assignee's tasks are a queue, in the order they arrived, moved on Início

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0151 (who sees what), doug-0012 (the editor's
deliveries) and the approval portal's tasks (ADR 9001).

## Context

The team gives the video editor work as tasks: a portal card is a task with its production day as the due date, a
delivery is a task too. Whoever asked first expects their video first. If a video of client A was handed over before a
video of client B, A's is edited before B's, whatever the dates say.

The team agenda on Início sorted each person's tasks by due date, then high priority, then number. That order is not
the team's: two videos due the same day came out by number, a later one with an earlier date jumped ahead, and nobody
could say "this one first" without changing a date. Agents read their open tasks by latest activity, so a comment moved
a task ahead.

## Decision

### 1. A queue per assignee

`issues.queue_position` (double precision, nullable; made at boot by `EXTRA_COLUMNS`, which lines up the open tasks once) is a task's place in its assignee's queue, lowest
first. A queue is one assignee's open tasks (`todo`, `in_progress`, `in_review`), person or agent.

- A task that gets an assignee, when made (`createIssue`) or when the assignee changes (`updateIssue`), goes to the end
  of that assignee's queue: `max + 1`, read in the same statement (`queueEndSql`).
- A task that loses its assignee leaves the queue (`null`).
- A closed task opened again with an assignee arrives again: the end of the queue.
- Closing a task leaves its number alone: queues only ever read open tasks.

The migration lines up the open tasks already assigned by when they were assigned (their last `assigned` event in
`issue_activity`), or when they were made when there is none.

### 2. The order is the priority

Everything that lists a person's work reads the queue (`queueOrder`: position, then a task with none by number):

- the team agenda (`teamAgenda`): each lane is that person's queue. Undated open tasks show in this week's view now,
  since they are part of the queue. A day picked in the strip keeps only that day's tasks, still in queue order;
- "Suas tarefas" on Início (`myPortalWork`): inside each group (late, today, next, undated) the cards go in the order of
  their tasks in the person's queue (`portalQueueOf`), cards with no task of theirs after;
- an agent's "# Your open tasks" (`openTasksBrief`): in queue order, the first one first. Agents take an assigned task
  when asked; this list is the order they pick up from when they have several.

The due date stays on each row as a chip ("Entrega amanhã"), and a late one keeps its own mark ("Era para 14 nov", in
the attention tone). Dates no longer sort.

### 3. Moving a task

`PUT /api/app/organizations/{orgId}/queues/{assigneeType}/{assigneeId}` with `{ taskId, afterId }` puts the task right
after `afterId`, or at the top with `null` (`moveInQueue`). Positions are fractional: the move takes the middle of its
new neighbours and writes one row. When two neighbours get closer than `1e-6`, or a task in the queue has no place yet,
the queue is renumbered 1, 2, 3… first, under a per-queue advisory lock.

- Owners and administrators only, the people who see the agenda (ADR 0151). Anyone else gets 403.
- Each move is in the audit log as `issue.queue_changed` (the task, the assignee, from and to).
- Every administrator's screens hear the user event `issue.queue` (the assignee, nothing about the task) and read the
  agenda again; the person who moved it sees the move at once (`useMoveInQueue`, `movedInAgenda`).

A day view sends the move relative to what shows: dropped at the top of a day, the task goes right after the task the
queue has before that day's first one (`queueMoveFor`), so it lands before the day's first and after everything above
it that doesn't show.

### 4. The screens

On the web, each lane of the agenda is an ordered list. A row has a handle (the kit's small ghost button with the grip
icon), its place, then the task. The handle is dragged with a mouse or a finger (`useQueueDrag`, the vertical sibling
of the portal's `useListDrag`): a bar shows where it lands, the page scrolls near the window's edges, Esc gives it up.
On the keyboard, the handle's up and down arrows move the task one place, and the new place is said aloud.

The phone app has no team agenda and no "Suas tarefas" list today. Its Início glance ("o editor agora") shows the video
the editor last touched in Revisão, which is what is being done, not a queue: it stays as it is.

## Consequences

- The agenda and an agent's task list now read the same order, set by people.
- Queues are per assignee: moving a task to someone else puts it at the end of their queue, never in the middle.
- A task due in a later week still holds its place in the queue: the agenda shows it in its own week.
