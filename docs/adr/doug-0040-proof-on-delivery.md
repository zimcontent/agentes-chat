# doug-0040: Proof on delivery

Status: accepted. This instance's own. 2026-11-20. Builds on ADR 0064 (team actions), ADR 0097 (how a turn ends),
ADR 0157 (who sees a file) and ADR 0167 (the `unbacked` verdict).

## Context

Agents end a job with "pronto!" and people go and check whether it is true. The turn-end judge already holds back a
claim no call backs (`unbacked`, ADR 0167), and it did so 455 times in 30 days in production: the claim is common, and
even a true one leaves the person opening the Drive, the task list or GitHub to see it. The owner asked for each
delivery to carry its proof, on one condition: it takes almost no room. One small line under the reply ("📎
relatorio.pdf · 🔗 tarefa #42 · 🖼 print"), opening only on a click. No new cards.

## Decision

**The proof is read from what the run did, never from its words.** `runProof` (`packages/engine/src/run-proof.ts`)
reads the run's `tool_result` steps and its `team_actions` rows, and `proofOf` turns them into items:

- `file`: a Drive file a call saved or changed (`data.artifact`, the shape every file tool returns);
- `image`: the same from a `*_screenshot` call shared in the chat;
- `task`: a task a call created or changed (`data.issue`), by its number;
- `link`: a pull request or a branch from a team action's `github:` target, a page from its `url:` target, or the page a
  connector answered with when the call makes or changes something (`html_url`, `webViewLink`, `permalink` and their
  kin, never a bare `url`, which is often the API's own);
- `action`: an outside action with nothing to open (an email sent, a number called), named by its target.

Every address loses its query and fragment (a signed link or a token rides there), and only https is kept. A failed
call proves nothing. One item per thing, files first, at most six (`PROOF_MAX`).

A computer brain's calls through the bridge are the gateway's steps too, so Claude Code and Codex get the same proof
for what reaches the server; what they do only on their computer (a file never shared) has nothing a person could open.

**It rides on the message it proves.** `post` in `executor.ts` reads the proof since the run's last message
(`Transcript.proof`: the last step's `seq` and the last team action's id, kept across a resume) and writes it as
`meta.proof: [{ kind, label, ref }]`, beside `meta.teamChecks`. A message with nothing new carries nothing. A file shows
only when the people of the conversation see it (its conversation's or the whole Drive's, `filesOfRun`'s rule) and it is
in the Drive and not in the trash: a block or a poll is already in the chat. A task is named by its number only.

**The judge reads it.** The turn-end judgment gets the whole run's proof as `proof`, one short line per item, and the
`unbacked` criterion says a claim one of them backs is backed. No new verdict, no new rule.

**The apps draw one quiet line.** `proofOf` and `proofLine` in `packages/client/src/lib/proof.ts` check each item (a
link only over https, a task only by a number) and leave out what the message already shows above the line: a file
with its card (`meta.artifacts`) and a task with its chip (`meta.tasks`). The web's `ProofLine`
(`apps/web/src/components/ProofLine.tsx`) and the phone's (`apps/mobile/src/features/chat/ProofLine.tsx`) show the
first three items in the muted footnote type with the kit's icons, then "+N", which shows the rest. A file opens the
viewer (the phone's file screen), a task its page, a link the browser; an action is words.

## Consequences

- A delivery shows its proof in one line, and the judge holds back fewer true claims.
- A file the run made shows twice only where the card already is: the line leaves it out there.
- What a connector made is proof only when its answer names its page in one of the known fields; other services show
  no link until their field is added.
- An outside action is shown only by its target, never by its summary, which can carry the call's own words.
