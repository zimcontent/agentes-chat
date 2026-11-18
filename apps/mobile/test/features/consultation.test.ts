import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composerRequestFor,
  currentComposerRequest,
  requestComposerText,
  takeComposerRequest,
} from "../../src/features/chat/composer-request";
import { consultationHref } from "../../src/features/links/logic";

test("two agents' conversation opens on its screen, with the conversation that asked", () => {
  expect(consultationHref("q1", "c1")).toBe("/consultation/q1?channel=c1");
  // A row of one opens as it always did; a row of several carries every question, so each agent is reachable.
  expect(consultationHref("q1", "c1", ["q1"])).toBe("/consultation/q1?channel=c1");
  expect(consultationHref("q2", "c1", ["q1", "q2"])).toBe("/consultation/q2?channel=c1&group=q1,q2");
  const group = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultGroup.tsx"), "utf8");
  expect(group).toContain("const ids = items.map((x) => x.id);");
  expect(group).toContain("consultationHref(opens, channelId, ids)");
  const route = readFileSync(join(import.meta.dir, "../../app/(app)/consultation/[id].tsx"), "utf8");
  expect(route).toContain('group.split(",").filter(isSafeId)');
});

test("'Falar com o Theo' hands '@theo ' to that conversation's composer, once", () => {
  requestComposerText("c1", "@theo ");
  const asked = currentComposerRequest();
  expect(asked).toMatchObject({ channelId: "c1", text: "@theo " });
  // Only that conversation's screen takes it.
  expect(composerRequestFor(asked, "c1")).toBe(asked);
  expect(composerRequestFor(asked, "c2")).toBeNull();
  // A request that isn't the one waiting leaves it; the one waiting, taken, is gone.
  takeComposerRequest((asked?.at ?? 0) - 1);
  expect(currentComposerRequest()).toBe(asked);
  takeComposerRequest(asked?.at ?? 0);
  expect(currentComposerRequest()).toBeNull();
});

test("the two agents' line is always one line: the subject gives way first, the word and time never", () => {
  const group = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultGroup.tsx"), "utf8");
  const pair = group.slice(group.indexOf("<AgentFace agentId={askerId}"), group.indexOf("</Pressable>"));
  expect(pair).not.toContain('ellipsizeMode="clip"');
  expect(pair).toContain("numberOfLines={1} style={styles.subject}");
  // Its · goes with it: a subject with no room left leaves no lone dot.
  expect(pair).toContain("· $" + "{subject}");
  const row = group.slice(group.indexOf("  row: {"), group.indexOf("},", group.indexOf("  row: {")));
  expect(row).not.toContain("flexWrap");
  // The names shrink only once the subject has none left: its share of any shrink dwarfs theirs.
  expect(group).toContain("subject: { flexShrink: 100000 },");
  expect(group).toContain('name: { fontWeight: "600", flexShrink: 1 },');
  expect(group).toContain('word: { fontWeight: "600", flexShrink: 0 },');
  expect(group).toContain('time: { fontVariant: ["tabular-nums"], flexShrink: 0 },');
});

test("on a phone's width the line leaves the subject out, as the web's under 420 (no '· …' between two dots)", () => {
  const group = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultGroup.tsx"), "utf8");
  expect(group).toContain("const SUBJECT_ROOM = 420;");
  expect(group).toContain("const roomy = useWindowDimensions().width >= SUBJECT_ROOM;");
  expect(group).toContain("const subject = roomy ? consultSubject(opened?.question) : null;");
  const css = readFileSync(join(import.meta.dir, "../../../web/src/layout.css"), "utf8");
  expect(css).toContain("@container (max-width: 420px) {\n  .consult-pair__subject {\n    display: none;");
});

test("a reach line offers Adicionar ao grupo where the web's does, for who manages channels", () => {
  const reach = readFileSync(join(import.meta.dir, "../../src/features/chat/ReachLines.tsx"), "utf8");
  expect(reach).toContain('((handed && e.reason === "not_in_channel") || Boolean(e.private)) &&');
  expect(reach).toContain('can(org, "manage_channels")');
  expect(reach).toContain('label={t("reach.add")}');
  const web = readFileSync(join(import.meta.dir, "../../../web/src/components/ReachLines.tsx"), "utf8");
  expect(web).toContain('((handed && e.reason === "not_in_channel") || e.private)');
});

test("two agents' conversation is a sheet over the one that asked, as the web's dialog", () => {
  const layout = readFileSync(join(import.meta.dir, "../../app/(app)/_layout.tsx"), "utf8");
  expect(layout).toContain('<Stack.Screen name="consultation/[id]" options={formSheet} />');
  const screen = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultationScreen.tsx"), "utf8");
  expect(screen).toContain("<SheetSurface>");
  expect(screen).not.toContain("PushedHeader");
  // A row of several: the sheet is named as the row is and offers each asked agent, saying where it stands.
  expect(screen).toContain("consultChoices(items");
  expect(screen).toContain("t(consultChoiceKey(ch.state, ch.item))");
  expect(screen).toContain("<Segmented");
});

test("the composer names whom it writes to in its placeholder only: no face in an agent's field", () => {
  const composer = readFileSync(join(import.meta.dir, "../../src/ui/Composer.tsx"), "utf8");
  expect(composer).not.toMatch(/\bface\?:/);
  for (const screen of ["chat/ChatScreen.tsx", "computer/AgentScreen.tsx"])
    expect(readFileSync(join(import.meta.dir, "../../src/features", screen), "utf8")).not.toMatch(
      /\bface[=:]\s*[{<]<?AgentFace/,
    );
});
