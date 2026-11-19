import type { PlanCard, PortalCardFile, PortalCardInput } from "@agenteschat/client";
import { useAgents, useApi, useMembers, usePortalPlan, useSavePortalCard } from "@agenteschat/client";
import { listsAgent } from "@agenteschat/client/lib/audience";
import { errorText } from "@agenteschat/client/lib/errors";
import { portalWithResponsible } from "@agenteschat/client/lib/portal";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Button, GroupedHeader, GroupedList, GroupedRow, IconButton, Text, useToast } from "@/ui";
import { Stepper } from "../reminders/DayTimePicker";
import { streamedPart } from "../review/media";
import { Face } from "../shared/Face";
import { useColors, useOrgId } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { successHaptic } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { usePortalFailed, usePortalWords } from "./hooks";
import { allPlanCards, LABEL_COLOR, SCHEDULE_STEP, stepClock, toggledLabels, ymdOf } from "./model";

/**
 * The card's own editing on the phone (ADR 9001 §8): what the web's card dialog changes, in the phone's shapes. A day
 * is picked on a month (`DateSheet`), labels and members each in a sheet of their own that keeps every change as it is
 * pressed (`LabelsSheet`, `MembersSheet`), and files come from the phone's library or files into the Drive and onto the
 * card (`useAddCardFiles`). Every sheet reads the card again from the board, so what it shows is what was saved.
 */

/** A card's fields saved at once, a refusal as a toast in the portal's words. */
export function useCardPatch(cardId: string) {
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const save = useSavePortalCard(orgId);
  return {
    pending: save.isPending,
    patch: (fields: PortalCardInput, onSaved?: () => void) =>
      save.mutate({ cardId, ...fields }, { onError: failed, ...(onSaved ? { onSuccess: onSaved } : {}) }),
  };
}

/** The card as the board has it now (null while it loads, or once it is gone). */
function useLiveCard(client: string, cardId: string) {
  const orgId = useOrgId();
  const plan = usePortalPlan(orgId, client);
  return { plan: plan.data, card: allPlanCards(plan.data).find((x) => x.id === cardId) ?? null };
}

/** The six or so weeks a month shows, from the week its first day is in, the week starting on Sunday. */
export function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(ymdOf(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const DAY_CELL = 40;

/**
 * A day on a month, as the web's date picker: the month's name between ‹ and ›, the week's letters, the days (today
 * ringed, the chosen one filled); with `time`, the hour and the minute under it as steppers. "Salvar" keeps it, "Sem
 * data" takes the date away.
 */
export function DateSheet({
  title,
  day,
  time,
  onSave,
}: {
  title: string;
  day: string | null;
  /** The post's time (`HH:MM`); undefined: a date with no time (the production date). */
  time?: string | undefined;
  onSave: (day: string | null, time: string) => void;
}) {
  const { i18n } = useTranslation();
  const w = usePortalWords();
  const c = useColors();
  const sheet = useSheet();
  const today = ymdOf(new Date());
  const [pick, setPick] = useState<string | null>(day);
  const [clock, setClock] = useState(time ?? "09:00");
  const start = pick ?? today;
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const cells = monthCells(view.y, view.m);
  const monthName = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
    new Date(view.y, view.m, 1),
  );
  // Sunday first: 2023-01-01 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" }).format(new Date(2023, 0, 1 + i)),
  );
  const shift = (by: number) => {
    const d = new Date(view.y, view.m + by, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const done = (next: string | null) => {
    sheet.close();
    onSave(next, clock);
  };
  return (
    <>
      <SheetTitle title={title} />
      <View style={styles.monthHead}>
        <IconButton icon="back" label={w.edit.previousMonth} onPress={() => shift(-1)} />
        <Text variant="title" style={styles.monthName}>
          {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
        </Text>
        <IconButton icon="right" label={w.edit.nextMonth} onPress={() => shift(1)} />
      </View>
      <View style={styles.grid}>
        {weekdays.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the week's seven letters, in order
          <View key={i} style={styles.cell}>
            <Text variant="caption" tone="faint">
              {d.toUpperCase()}
            </Text>
          </View>
        ))}
        {cells.map((d, i) => {
          if (!d) {
            // biome-ignore lint/suspicious/noArrayIndexKey: the empty places before and after the month
            return <View key={`e${i}`} style={styles.cell} />;
          }
          const chosen = d === pick;
          const isToday = d === today;
          return (
            <View key={d} style={styles.cell}>
              <Pressable
                onPress={() => setPick(d)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={new Intl.DateTimeFormat(i18n.language, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }).format(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))))}
                style={({ pressed }) => [
                  styles.day,
                  chosen ? { backgroundColor: c.green } : null,
                  isToday && !chosen ? { borderWidth: 1.5, borderColor: c.green } : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text
                  variant="body"
                  style={[styles.dayText, { color: chosen ? c.greenInk : isToday ? c.greenText : c.ink }]}
                >
                  {Number(d.slice(8, 10))}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {time !== undefined && pick ? (
        <View style={styles.clock}>
          <Text variant="subhead" tone="muted">
            {w.edit.time}
          </Text>
          <View style={styles.clockRow}>
            <Stepper
              value={clock.slice(0, 2)}
              label={w.hour}
              lessLabel={w.hourLess}
              moreLabel={w.hourMore}
              onLess={() => setClock(stepClock(clock, -60))}
              onMore={() => setClock(stepClock(clock, 60))}
            />
            <Text variant="display" tone="faint">
              :
            </Text>
            <Stepper
              value={clock.slice(3, 5)}
              label={w.minute}
              lessLabel={w.minuteLess(SCHEDULE_STEP)}
              moreLabel={w.minuteMore(SCHEDULE_STEP)}
              onLess={() => setClock(stepClock(clock, -SCHEDULE_STEP))}
              onMore={() => setClock(stepClock(clock, SCHEDULE_STEP))}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.acts}>
        <Button variant="primary" wide label={w.edit.saveDate} disabled={!pick} onPress={() => done(pick)} />
        {day ? <Button variant="secondary" wide label={w.edit.clearDate} onPress={() => done(null)} /> : null}
        <Button variant="ghost" wide label={w.cancel} onPress={() => sheet.close()} />
      </View>
    </>
  );
}

/** The board's labels, each put on or taken off the card with a press, kept at once. */
export function LabelsSheet({ client, cardId }: { client: string; cardId: string }) {
  const w = usePortalWords();
  const sheet = useSheet();
  const { plan, card } = useLiveCard(client, cardId);
  const { patch } = useCardPatch(cardId);
  if (!plan || !card) return null;
  return (
    <>
      <SheetTitle title={w.edit.labelsEdit} subtitle={card.title} />
      {plan.labels.length === 0 ? (
        <Text variant="body" tone="muted">
          {w.edit.noBoardLabels}
        </Text>
      ) : (
        <GroupedList>
          {plan.labels.map((l) => (
            <GroupedRow
              key={l.id}
              label={l.name || w.labels}
              leading={<View style={[styles.swatch, { backgroundColor: LABEL_COLOR[l.color] }]} />}
              checked={card.labels.includes(l.id)}
              onPress={() => patch({ labels: toggledLabels(card.labels, l.id) })}
            />
          ))}
        </GroupedList>
      )}
      <Button variant="primary" wide label={w.confirm} onPress={() => sheet.close()} />
    </>
  );
}

/**
 * Who is on the card: the workspace's people, then its agents (those the workspace lists, and any already on it). A
 * press puts one on or takes them off; the first is the one responsible, who has the card's task, and "Tornar
 * responsável" makes another one it. An agent made responsible starts on it at once (the server's rule).
 */
export function MembersSheet({ client, cardId }: { client: string; cardId: string }) {
  const w = usePortalWords();
  const sheet = useSheet();
  const orgId = useOrgId();
  const { org } = useOrg();
  const { card } = useLiveCard(client, cardId);
  const { patch } = useCardPatch(cardId);
  const members = useMembers(orgId).data ?? [];
  const dir = useAgents(orgId).data ?? [];
  if (!card) return null;
  const responsible = card.members[0];
  const toggle = (id: string) =>
    patch({ members: card.members.includes(id) ? card.members.filter((x) => x !== id) : [...card.members, id] });
  const agents = dir.filter((a) => listsAgent(org, a) || card.members.includes(a.id));
  const row = (id: string, name: string, who: { type: "user" | "agent"; id: string }) => {
    const on = card.members.includes(id);
    const lead = id === responsible;
    return (
      <GroupedRow
        key={id}
        label={name}
        {...(lead ? { sub: w.responsible } : {})}
        leading={<Face who={who} size={28} live={false} />}
        checked={on}
        onPress={() => toggle(id)}
        {...(on && !lead
          ? {
              buttons: [
                {
                  icon: "flag" as const,
                  label: `${w.edit.makeResponsible}: ${name}`,
                  onPress: () => patch({ members: portalWithResponsible(card.members, id) }),
                },
              ],
            }
          : {})}
      />
    );
  };
  return (
    <>
      <SheetTitle title={w.edit.membersEdit} subtitle={card.title} />
      <Text variant="footnote" tone="muted">
        {w.edit.agentStarts}
      </Text>
      <View>
        <GroupedHeader>{w.edit.people}</GroupedHeader>
        <GroupedList>{members.map((m) => row(m.userId, m.name, { type: "user", id: m.userId }))}</GroupedList>
      </View>
      {agents.length > 0 ? (
        <View>
          <GroupedHeader>{w.edit.agents}</GroupedHeader>
          <GroupedList>{agents.map((a) => row(a.id, a.name, { type: "agent", id: a.id }))}</GroupedList>
        </View>
      ) : null}
      <Button variant="primary" wide label={w.confirm} onPress={() => sheet.close()} />
    </>
  );
}

/**
 * Files from the phone onto the card: pictures and videos from the library (several at once, in the order picked) or
 * any file, each uploaded to the Drive as the web's "Upload" does (a video streamed from its place, with its progress),
 * then put at the card's end. What was uploaded before a failure stays on the card.
 */
export function useAddCardFiles(card: PlanCard) {
  const w = usePortalWords();
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const toast = useToast();
  const { patch } = useCardPatch(card.id);
  // The card as it is when the uploads end, not when they started: files added or taken off meanwhile (here or on the
  // web) are kept.
  const latest = useRef(card);
  latest.current = card;
  const [progress, setProgress] = useState<{ at: number; total: number; pct: number } | null>(null);
  const upload = async (picked: { uri: string; name: string; type: string }[]) => {
    if (picked.length === 0) return;
    const added: PortalCardFile[] = [];
    try {
      for (const [i, f] of picked.entries()) {
        setProgress({ at: i + 1, total: picked.length, pct: 0 });
        const part = streamedPart(f.uri, f.name, f.type) as unknown as Parameters<typeof api.artifacts.upload>[1];
        const saved = await api.artifacts.upload(orgId, part, {
          onProgress: (sent: number) => setProgress({ at: i + 1, total: picked.length, pct: Math.round(sent * 100) }),
        });
        added.push({ id: saved.id, name: saved.title || f.name });
      }
    } catch (e) {
      toast({ title: errorText(t, e), icon: "x" });
    } finally {
      setProgress(null);
      if (added.length > 0)
        patch({ files: [...latest.current.files, ...added] }, () => {
          successHaptic();
          toast({ title: w.edit.uploaded(added.length), icon: "check" });
        });
    }
  };
  const photos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast({
        title: w.edit.noPhotos,
        icon: "photos",
        action: { label: w.edit.openSettings, onPress: () => void Linking.openSettings() },
      });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 1,
      allowsMultipleSelection: true,
      orderedSelection: true,
    });
    if (res.canceled) return;
    await upload(
      res.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? (a.type === "video" ? "video.mp4" : "photo.jpg"),
        type: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
      })),
    );
  };
  const files = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (res.canceled) return;
    await upload(res.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream" })));
  };
  return { progress, photos: () => void photos(), files: () => void files() };
}

const styles = StyleSheet.create({
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthName: { flex: 1, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: DAY_CELL + 4, alignItems: "center", justifyContent: "center" },
  day: {
    width: DAY_CELL,
    height: DAY_CELL,
    borderRadius: DAY_CELL / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.6 },
  clock: { alignItems: "center", gap: 4 },
  clockRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  acts: { gap: 8 },
  swatch: { width: 28, height: 16, borderRadius: 4 },
});
