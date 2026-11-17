# doug-0012: an editor's delivery, from the task to the client and the backup

Status: accepted. This instance's own. 2026-11-15.

## Context

Not every video is made by an agent. A person of the team (an editor) edits many posts by hand. Until now the work came
on a board outside, the file went to a shared drive, and the review, the client's approval and the backup were each
done somewhere else, by hand. The workspace already has every piece: a post is a task of the Portal (ADR 9001 §11),
the team reviews videos in Review (doug-0007), and each client says what an approval means (doug-0010 §8). What was
missing is a way for a person to send a video into that path, and the path from an approved video to the client and
to a backup, with nobody having to know the flow to follow it.

## Decision

1. **The editor sends from the task.** A post's task shows "Entrega do vídeo", numbered steps. The editor drops the
   file there (up to 2 GB, the file of a conversation, ADR 0025). It is uploaded to the task's conversation and becomes
   a review like an agent's video (`video_reviews`, `sender_user_id` the person, `task_id` the task, the portal's
   client and card from the task), whose conversation is the task's: whoever sees the task reviews it. The next file
   is the next version. Any task a video was sent from shows the steps too; on a task that isn't a post they end at the
   approval.
2. **The decision comes back to the person.** Approve and Ask for changes post, as the person who decided, a message
   in the task's conversation naming the editor (`@handle`), with the notes of that version. It starts no agent's run.
3. **Review lists who sent it.** Besides agents, each person who sends shows as a filter of their own ("Revisão do
   Ronny"), only once someone has.
4. **The post's other parts are approved on the task.** After the video, the cover (a picture uploaded to the task, or
   none, and the portal uses the video) and the caption are each approved by the team (`video_reviews.post`). Changing
   one takes its approval back. Then one button, "Enviar para o cliente" (or "Aprovar e agendar" for a client set to
   `direct`), sends the post. Who may send is who may give agents work (`assign_work`, ADR 9001 §7).
5. **Light for review, a copy for the post, the original for the final.** The team watches the light copy of doug-0007,
   now made from a file on disk so a master of several GB is never held in memory (`VideoCopies`). The portal gets a
   copy made for the post (H.264, long side 1920 at most, CRF 20 capped at 12 Mb/s: `postKey` beside the file's
   bytes), which it shows the client in its own light copy and publishes from. The editor's original never leaves
   the workspace's storage until it is the final.
6. **The send is code** (job `editor_delivery.send`), the same upload and send as ADR 9001 §4, keyed by review and
   version so a retried job never sends twice. For a `direct` client the post is approved and released for its card's
   day. What happened is said in the task's conversation by the workspace's assistant.
7. **A change the client asks for goes straight back to them** (ADR 9001 §17): while the post is in `adjusting`, the
   editor's next file on the task is a new version at the portal, with no review in between, as the team decided for
   adjustments. While the client has the post and asked for nothing, a new file is refused.
8. **The final is kept, then backed up.** Once the client approves (the card reaches `approved`, `scheduled` or
   `posted`, read by the portal's tick), or at once for a `direct` client, the approved version's original is the
   final: it already lives in the workspace's storage (the storage server when the workspace has it on, doug-0010), and
   a copy goes to the installation's backup (`FileBackup`), in a folder of the workspace and the client, uploaded in
   pieces as it is read (job `editor_delivery.final`, `video_reviews.final`). The one backup is Google Drive, switched
   on by `BACKUP_GOOGLE_DRIVE_FOLDER_ID` with the client id, secret and refresh token of the account that owns that
   folder. A failed backup says so in the task and can be tried again.
9. **Tables stay outside the numbered migrations**, like doug-0007's: the new columns are in `EXTRA_COLUMNS`.

## Consequences

- An editor needs to be a member of the workspace and see the task; nothing else of the app is required of them.
- The task, its conversation and Review are one record of the post, from the first file to the final's backup.
- The backup's credentials are the installation's, not each workspace's: one Google account holds every workspace's
  finals, in folders apart. A workspace-owned backup is a later decision.
- The phone app reads the same review; sending from a task's steps is on the web (a phone's browser included).

## Addendum 2026-11-16: rounds, their log, the WhatsApp notice and the client's own notes

10. **A round per change asked, and its log.** Every time the team asks for changes, or the client asks at the
    portal, a round opens for the person who sent the work (`video_review_rounds`): who asked and when, when the
    person was told beyond the app, when they first opened the review (`seen_at`, only their own opening counts), and
    when their next version came (`answered_at`, `answered_version`). The review page shows the rounds as
    "Histórico de ajustes", and each list row says where the newest stands (asked, seen, answered). Nothing here is
    about video or an editor: any member who sends work for review gets the same.
11. **Each person has their own view, and is told where they read.** Review opens on "Meus ajustes" for whoever has
    changes waiting, with "Ajuste para fazer" on each. Whoever may give work picks, on a person's tab, a conversation
    of one of the workspace's WhatsApp numbers (a group such as "Rony Demandas", `review_whatsapp`). When a round
    opens, a job (`review_round.notify`) posts there, as that number's agent, a line written in code: the work, who
    asked, the notes with their times, the review's link and the task's. What happened is kept on the round.
12. **The client's portal and the player are one.** The bridge lists what the client wrote on each post (each point
    they marked, with the second, the slide and the spot, and each request with no mark; their attachments as links:
    `notas_cliente`). The portal's tick brings each into the post's review once (`external_id`), on the review's
    version the portal's version stands for (`portal_versions`, kept as each version is sent), at its second, as the
    client's (`from_client`, `author_name`). A change asked opens a round for the editor, told like the team's, and
    the review waits on them; their next version goes straight back to the client (§7). The client's words are notes
    for people, never a model's prompt.

## Addendum 2026-11-16: a task that asks for several videos

13. **A task may ask for several videos, each its own review and post.** A demand is often 2, 5 or 15 videos at once.
    Each file dropped on the task (one or many at a time) is a new video of it: a review of its own, numbered in the
    task (`video_reviews.task_part`), titled "<task> · Vídeo n" once there is more than one. A new version goes to the
    video it is sent from (`reviewId`), never to whichever is newest. The task lists its videos, each a row that opens
    to its own steps (video, cover, caption, client, final); Review shows a task's videos together under the task, with
    how many are approved, and the player has the task's other videos one click away. At the portal each video is its
    own post: the first finishes the task's card, every other one gets a card of its own beside it (same day and list)
    tied to the same task, so the portal's sync makes no new task of it. Where each post stands with the client is read
    from the post itself on every tick (`delivery.stage`), so one video's approval, change or final never speaks for
    another's.

## Addendum 2026-11-17: `direct` approves and stops there

For a `direct` client the post is still sent and marked approved at the portal, but it is no longer released for its
card's day: nothing schedules a post but a person, by hand, at the Portal (ADR 9001, addendum 2026-11-17). The
conversation is told the post is ready and that the team schedules it.
