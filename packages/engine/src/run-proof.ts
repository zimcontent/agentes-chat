import { and, asc, type Executor, eq, gt, inArray, isNull, or, schema } from "@dougbot/db";
import { shownTarget } from "./team-actions";
import { HARNESS_PREFIX } from "./tools/directory";

const { agentRunSteps, artifacts, teamActions } = schema;

/**
 * Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md): what a run really delivered, read from what it did (its
 * steps and its team actions), never from its words. It rides on the reply as `meta.proof`, one quiet line of chips
 * under it, and the turn-end judge reads it as evidence for what the reply claims (`continuationVerdict`).
 *
 * - `file`: a Drive file it saved or changed (`ref` the artifact's id).
 * - `image`: a screenshot it shared (`*_screenshot` with `share`), the same.
 * - `task`: a task it created or changed (`ref` its number).
 * - `link`: a page out there it made or changed: a pull request, a page a connector answered with (`ref` the URL,
 *   never its query or fragment).
 * - `action`: an outside action with no page to open (an email sent, a branch pushed): `label` alone.
 */
export type ProofKind = "file" | "image" | "task" | "link" | "action";

export interface ProofItem {
  kind: ProofKind;
  label: string;
  ref?: string;
}

/** The most items one message keeps; the apps show what fits in one line and "+N". */
export const PROOF_MAX = 6;

/** Where a message's proof read up to (`Transcript.proof`): the last step and the last team action read. */
export interface ProofMark {
  seq: number;
  action: string | null;
  /** The run's executed calls (`Transcript.executedCalls`) when it was read: none since, nothing to read. */
  calls?: number;
}

/** A tool's result step, as `proofOf` reads it. */
export interface ProofStep {
  name: string;
  isError?: boolean;
  external?: boolean;
  content?: unknown;
  data?: Record<string, unknown> | null;
}

/** A team action (ADR 0064), as `proofOf` reads it. */
export interface ProofAction {
  tool: string;
  targets: string[];
}

const LABEL_CHARS = 80;
const cut = (s: string) => (s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS - 1)}…` : s);

/** A connector call that makes or changes something: only its answer's page is proof of it. */
const WRITES =
  /(^|_)(create|update|send|post|add|comment|publish|upload|merge|edit|insert|append|reply|share)(?=_|[A-Z]|$|s_|s$)/;
/** The fields a service names its page with (GitHub, GitLab, Google Drive, Notion, Slack, Trello…): never `url`. */
const PAGE_FIELD =
  /"(html_url|htmlUrl|web_url|webUrl|webViewLink|permalink|shortUrl|shortLink)"\s*:\s*"(https:\/\/[^"\s]+)"/;

/** An https page without its query and fragment (a signed link or a token rides there), or null. */
export function proofUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const urlLabel = (url: string) => cut(url.replace(/^https:\/\/(www\.)?/, ""));

/** A team action's target as an item: a page to open where it has one. */
function targetItem(target: string): ProofItem | null {
  const github = /^github:([\w.-]+\/[\w.-]+)([#@])(.+)$/.exec(target);
  if (github) {
    const [, repo, sep, rest] = github as unknown as [string, string, string, string];
    const path = sep === "#" ? `issues/${rest}` : `tree/${rest}`;
    return {
      kind: "link",
      label: cut(`${repo.split("/")[1]}${sep}${rest}`),
      ref: `https://github.com/${repo}/${path}`,
    };
  }
  if (target.startsWith("url:")) {
    const url = proofUrl(`https://${target.slice(4)}`);
    return url ? { kind: "link", label: urlLabel(url), ref: url } : null;
  }
  const shown = shownTarget(target);
  return shown ? { kind: "action", label: cut(shown) } : null;
}

/**
 * The proof in a run's result steps and team actions, in order of what people most want to open (files, screenshots,
 * tasks, pages, the rest), one item per thing, at most `PROOF_MAX`. Pure: `runProof` reads the rows.
 */
export function proofOf(steps: ProofStep[], actions: ProofAction[] = [], max = PROOF_MAX): ProofItem[] {
  const found: ProofItem[] = [];
  for (const step of steps) {
    if (step.isError) continue;
    const name = step.name.replace(HARNESS_PREFIX, "");
    const data = step.data ?? {};
    const artifact = data.artifact as { id?: unknown; title?: unknown } | undefined;
    if (artifact && typeof artifact.id === "string") {
      const shot = /_screenshot$/.test(name);
      found.push({
        kind: shot ? "image" : "file",
        label: shot ? "" : cut(typeof artifact.title === "string" ? artifact.title : ""),
        ref: artifact.id,
      });
    }
    const issue = data.issue as { number?: unknown } | undefined;
    if (issue && typeof issue.number === "number")
      found.push({ kind: "task", label: `#${issue.number}`, ref: String(issue.number) });
    if (step.external && WRITES.test(name) && typeof step.content === "string") {
      const page = PAGE_FIELD.exec(step.content);
      const url = page?.[2] ? proofUrl(page[2]) : null;
      if (url) found.push({ kind: "link", label: urlLabel(url), ref: url });
    }
  }
  for (const action of actions) {
    for (const target of action.targets) {
      const item = targetItem(target);
      if (item) found.push(item);
    }
  }
  const order: ProofKind[] = ["file", "image", "task", "link", "action"];
  const seen = new Set<string>();
  return found
    .filter((item) => {
      const key = `${item.kind}:${item.ref ?? item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .slice(0, max);
}

/**
 * The proof of a run since `since` (none: from its start), with where it read up to. A file shows only when the
 * people of `channelId` see it (`filesOfRun`'s rule: its conversation's or the Drive's at large), and only while it
 * is in the Drive: a block or a poll is in the chat already, a file in the trash proves nothing.
 */
export async function runProof(
  db: Executor,
  run: { orgId: string; id: string; channelId: string },
  since: ProofMark | null = null,
): Promise<{ items: ProofItem[]; mark: ProofMark }> {
  const [steps, actions] = await Promise.all([
    db
      .select({ seq: agentRunSteps.seq, data: agentRunSteps.data })
      .from(agentRunSteps)
      .where(
        and(
          eq(agentRunSteps.orgId, run.orgId),
          eq(agentRunSteps.runId, run.id),
          eq(agentRunSteps.kind, "tool_result"),
          ...(since ? [gt(agentRunSteps.seq, since.seq)] : []),
        ),
      )
      .orderBy(asc(agentRunSteps.seq)),
    db
      .select({ id: teamActions.id, tool: teamActions.tool, targets: teamActions.targets })
      .from(teamActions)
      .where(
        and(
          eq(teamActions.orgId, run.orgId),
          eq(teamActions.runId, run.id),
          ...(since?.action ? [gt(teamActions.id, since.action)] : []),
        ),
      )
      .orderBy(asc(teamActions.id)),
  ]);
  const mark: ProofMark = {
    seq: steps.at(-1)?.seq ?? since?.seq ?? 0,
    action: actions.at(-1)?.id ?? since?.action ?? null,
  };
  const items = proofOf(
    steps.map(({ data }) => {
      const d = data as Record<string, unknown>;
      return {
        name: typeof d.name === "string" ? d.name : "",
        isError: d.isError === true,
        external: d.external === true,
        content: d.content,
        data: (d.data as Record<string, unknown> | undefined) ?? null,
      };
    }),
    actions,
    // Cut after the files people here can't see are out (below), never before: a hidden one takes no visible one's place.
    Number.POSITIVE_INFINITY,
  );
  const ids = items.flatMap((i) => ((i.kind === "file" || i.kind === "image") && i.ref ? [i.ref] : []));
  if (ids.length === 0) return { items: items.slice(0, PROOF_MAX), mark };
  const seen = new Set(
    (
      await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.orgId, run.orgId),
            inArray(artifacts.id, ids),
            isNull(artifacts.deletedAt),
            eq(artifacts.inDrive, true),
            or(isNull(artifacts.channelId), eq(artifacts.channelId, run.channelId)),
          ),
        )
    ).map((r) => r.id),
  );
  return {
    items: items.filter((i) => (i.kind !== "file" && i.kind !== "image") || seen.has(i.ref ?? "")).slice(0, PROOF_MAX),
    mark,
  };
}

/** The proof as the turn-end judge reads it: one short line per item. */
export const proofLines = (items: ProofItem[]): string[] =>
  items.map((i) => (i.kind === "image" ? "screenshot shared in the chat" : `${i.kind}: ${i.label}`));
