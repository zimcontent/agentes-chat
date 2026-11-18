import { useIssues, useOverview, useVideoReviews, useWhatsApp, useWhatsAppChats } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { readValueSync, STORED, writeValueSync } from "@/lib/storage";
import { useOrg } from "@/providers/org";
import { Button, Icon, type IconName, PressScale, Text, useTheme, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { pillSurface, surfaceStyle } from "@/ui/surfaces";
import { useCreateAgent } from "../agents/elsewhere";
import type { PlusPick } from "../chat/sheets";
import { openIssuesWithMe } from "../me/logic";
import { useMediaOn } from "../media-gen/logic";
import { mayCreate } from "../new/logic";
import { usePortalOn, usePortalWords } from "../portal/hooks";
import { useReviewWords } from "../review/media";
import { useColors, useMeId } from "../shared/hooks";
import { MentionCount } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { accountsInOrder, unreadChats, useWhatsAppShown } from "../whatsapp/logic";
import { WhatsAppMark } from "../whatsapp/look";
import { frontOf, gridOf, pinsOf, type ToolDef, type ToolKey, togglePin, toolsHere, withPins } from "./all-tools";

// ── The pins, on this phone ──────────────────────────────────────────────────

const listeners = new Set<() => void>();
let stored: string | null | undefined;
const readStored = () => {
  if (stored === undefined) stored = readValueSync(STORED.homePins);
  return stored;
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The tools pinned to Início in this workspace (null: never chosen), and how to change them. */
export function usePins(orgId: string) {
  const raw = useSyncExternalStore(subscribe, readStored);
  const pins = useMemo(() => pinsOf(raw, orgId), [raw, orgId]);
  const setPins = useCallback(
    (next: readonly ToolKey[]) => {
      stored = withPins(readStored(), orgId, next);
      writeValueSync(STORED.homePins, stored);
      for (const l of listeners) l();
    },
    [orgId],
  );
  return { pins, setPins };
}

/**
 * Agenda's switch. Google Calendar comes in a change of its own: that change answers here whether this workspace has
 * it, and the tile shows (`calendar` in `TOOLS`).
 */
export const useCalendarOn = (): boolean => false;

// ── Every tool, with its words and what waits in it ─────────────────────────

export interface ToolShown extends ToolDef {
  label: string;
  count: number;
}

/**
 * The tools this person has here, labeled and counted, and Início's front row. WhatsApp's unread conversations are
 * asked only where they are shown (`whatsappCount`): they cost a request of their own.
 */
export function useAllTools({ whatsappCount }: { whatsappCount: boolean }) {
  const { t } = useTranslation();
  const { org, orgId } = useOrg();
  const meId = useMeId();
  const whatsapp = useWhatsAppShown();
  const media = useMediaOn();
  const portal = usePortalOn();
  const calendar = useCalendarOn();
  const review = useReviewWords();
  const portalWords = usePortalWords();
  const available = useMemo(
    () => toolsHere({ whatsapp, media, portal, calendar, member: can(org, "read"), hidden: org?.hiddenTools ?? [] }),
    [whatsapp, media, portal, calendar, org],
  );
  const { pins, setPins } = usePins(orgId);
  const front = useMemo(() => frontOf(available, pins), [available, pins]);

  const issues = useIssues(orgId);
  const proposals = useOverview(orgId).data?.proposalsWaitingForMe ?? 0;
  const reviews = (useVideoReviews(orgId).data ?? []).filter((r) => r.status === "in_review").length;
  const numbers = useWhatsApp(orgId, whatsapp && whatsappCount).data?.accounts ?? [];
  const mine = accountsInOrder(numbers).find((a) => a.mine)?.id ?? null;
  const chats = useWhatsAppChats(orgId, whatsapp && whatsappCount ? mine : null);
  const counts: Partial<Record<ToolKey, number>> = {
    issues: openIssuesWithMe(issues.data, meId),
    proposals,
    review: reviews,
    whatsapp: unreadChats(chats.data?.pages[0]?.chats ?? []),
  };
  const labels: Record<ToolKey, string> = {
    whatsapp: "WhatsApp",
    calendar: t("mobile.homeTools.calendar"),
    media: t("shell.media"),
    search: t("mobile.homeTools.searchTile"),
    proposals: t("shell.proposals"),
    issues: t("mobile.me.issues"),
    review: review.title,
    portal: portalWords.title,
    team: t("mobile.agents.title"),
    routines: t("routines.title"),
    dashboards: t("mobile.me.dashboards"),
    wiki: t("wiki.title"),
    drive: t("mobile.me.drive"),
    vault: t("mobile.homeTools.vault"),
    computer: t("mobile.homeTools.computer"),
    people: t("mobile.homeTools.people"),
    settings: t("mobile.homeTools.settings"),
  };
  const tools: ToolShown[] = available.map((tool) => ({
    ...tool,
    label: labels[tool.key],
    count: counts[tool.key] ?? 0,
  }));
  return { tools, front, pins: pins ?? front, setPins, counts };
}

/** Opens a tool: a tab is gone to, any other screen pushed over this one. */
export function openTool(tool: ToolDef) {
  if (tool.tab) router.navigate(tool.href as never);
  else router.push(tool.href as never);
}

// ── The sheet ────────────────────────────────────────────────────────────────

/** The grid's tiles: rounded glass squares (30% radius, as every square of the kit), the name under them. */
const TILE = 60;
const GLYPH = 22;
const PIN = 18;
/** The pills' height: a finger's target, round ends (as the kit's own buttons on dougbot.app). */
const PILL = 44;

export interface AllSheetProps {
  /**
   * Opened from a conversation's "+": what goes with a message (photos, camera, file) and what to start here (GIFs,
   * a mission, a summary, a reminder), each through the conversation's own `onPlus`.
   */
  conversation?: { media: boolean; onPick: (pick: PlusPick) => void };
}

/**
 * "Tudo": the title and "Editar atalhos", Buscar, every tool as a tile (a count where something waits, a pin on the
 * ones on Início's row), then, from Início, what to create, or, from a conversation, what to do in it and attach.
 * Editing, a tap pins or unpins (four at most) instead of opening.
 */
export function AllSheet({ conversation }: AllSheetProps) {
  const { t } = useTranslation();
  const sheet = useSheet();
  const toast = useToast();
  const { org } = useOrg();
  const createAgent = useCreateAgent();
  const { tools, pins, setPins } = useAllTools({ whatsappCount: true });
  const [editing, setEditing] = useState(false);
  const go = (then: () => void) => sheet.close(then);
  const press = (tool: ToolShown) => {
    if (!editing) {
      go(() => openTool(tool));
      return;
    }
    const change = togglePin(pins, tool.key);
    if (change.full) toast({ title: t("mobile.homeTools.full"), icon: "pin" });
    else setPins(change.pins);
  };
  const sections: PillSection[] = conversation
    ? [
        {
          title: t("mobile.homeTools.here"),
          pills: [
            ...(conversation.media ? [{ key: "media", icon: "sticker" as const, label: t("mobile.plus.media") }] : []),
            { key: "mission", icon: "target" as const, label: t("mobile.homeTools.mission") },
            { key: "summary", icon: "sparkle" as const, label: t("mobile.homeTools.summary") },
            { key: "remind", icon: "clock" as const, label: t("mobile.homeTools.remind") },
          ].map((x) => ({ ...x, onPress: () => conversation.onPick(x.key as PlusPick) })),
        },
        {
          title: t("mobile.homeTools.attach"),
          pills: (
            [
              { key: "photos", icon: "image", label: t("mobile.plus.photos") },
              { key: "camera", icon: "camera", label: t("mobile.plus.camera") },
              { key: "file", icon: "file", label: t("mobile.plus.file") },
            ] as const
          ).map((x) => ({ ...x, onPress: () => conversation.onPick(x.key) })),
        },
      ]
    : [
        {
          title: t("mobile.homeTools.create"),
          pills: [
            {
              key: "new",
              icon: "compose",
              label: t("mobile.homeTools.newChat"),
              onPress: () => go(() => router.push("/new")),
            },
            ...(mayCreate(org, "agent")
              ? [
                  {
                    key: "new-agent",
                    icon: "plus" as const,
                    label: t("mobile.homeTools.newAgent"),
                    // A new agent is asked of the right hand (the phone has no form for it).
                    onPress: () => go(() => createAgent()),
                  },
                ]
              : []),
          ],
        },
      ];
  return (
    <AllSheetView
      tools={tools}
      pins={pins}
      editing={editing}
      onEdit={() => setEditing(!editing)}
      onTool={press}
      onSearch={() => go(() => router.push("/search"))}
      sections={sections}
    />
  );
}

export interface Pill {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
}

export interface PillSection {
  title: string;
  pills: readonly Pill[];
}

/** The sheet as it draws, from what to show (the board draws it with samples). */
export function AllSheetView({
  tools,
  pins,
  editing,
  onEdit,
  onTool,
  onSearch,
  sections,
}: {
  tools: readonly ToolShown[];
  pins: readonly ToolKey[];
  editing: boolean;
  onEdit: () => void;
  onTool: (tool: ToolShown) => void;
  onSearch: () => void;
  sections: readonly PillSection[];
}) {
  const { t } = useTranslation();
  const grid = gridOf(tools, editing);
  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Text variant="title2" style={styles.grow}>
          {t("mobile.homeTools.all")}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          label={editing ? t("mobile.homeTools.done") : t("mobile.homeTools.edit")}
          onPress={onEdit}
        />
      </View>
      {editing ? (
        <Text variant="small" tone="muted">
          {t("mobile.homeTools.editHint")}
        </Text>
      ) : (
        <SearchEntry label={t("mobile.homeTools.search")} onPress={onSearch} />
      )}
      <View style={styles.grid}>
        {grid.map((tool) => (
          <ToolCell
            key={tool.key}
            tool={tool}
            pinned={pins.includes(tool.key)}
            editing={editing}
            onPress={() => onTool(tool)}
          />
        ))}
      </View>
      {editing
        ? null
        : sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text variant="small" tone="muted">
                {section.title}
              </Text>
              <Pills items={section.pills} />
            </View>
          ))}
    </View>
  );
}

/** Buscar as the sheet's field: it opens the app's search, where the typing happens. */
function SearchEntry({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.search, { backgroundColor: c.plate }, pressed && styles.pressed]}
    >
      <Icon name="search" size={18} color={c.muted} />
      <Text
        variant="subhead"
        tone="muted"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={styles.grow}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ToolCell({
  tool,
  pinned,
  editing,
  onPress,
}: {
  tool: ToolShown;
  pinned: boolean;
  editing: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { scheme } = useTheme();
  const said = [tool.label, tool.count > 0 ? String(tool.count) : null, pinned ? t("mobile.homeTools.pinned") : null]
    .filter(Boolean)
    .join(", ");
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole={editing ? "checkbox" : "button"}
      accessibilityLabel={said}
      {...(editing ? { accessibilityState: { checked: pinned } } : {})}
      style={styles.cell}
      contentStyle={styles.cellIn}
    >
      <View
        style={[
          styles.tile,
          surfaceStyle(pillSurface(scheme), Math.round(TILE * 0.3)),
          editing && !pinned ? styles.unpinned : null,
        ]}
      >
        {tool.icon === "whatsapp" ? (
          <WhatsAppMark size={GLYPH + 2} />
        ) : (
          <Icon name={tool.icon as IconName} size={GLYPH} color={c.ink} />
        )}
        {tool.count > 0 && !editing ? (
          <View style={styles.count}>
            <MentionCount count={tool.count} />
          </View>
        ) : null}
        {pinned ? (
          <View style={[styles.pin, { backgroundColor: c.ink, borderColor: c.bg }]}>
            <Icon name="pin" size={11} color={c.bg} />
          </View>
        ) : null}
      </View>
      {/* One line, as wide as the cell: a long name shrinks a little rather than break inside a word. */}
      <Text
        variant="caption"
        tone="ink2"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={styles.label}
      >
        {tool.label}
      </Text>
    </PressScale>
  );
}

/** The round glass pills under the grid (the tiles' surface), sharing their row's width. */
function Pills({ items }: { items: readonly Pill[] }) {
  const c = useColors();
  const { scheme } = useTheme();
  // Two or four: two to a row. Otherwise each as wide as its words, growing to fill its row, so a narrow phone wraps
  // the last one under the others instead of cutting a word.
  const halves = items.length === 2 || items.length === 4;
  return (
    <View style={styles.pills}>
      {items.map((p) => (
        <PressScale
          key={p.key}
          onPress={p.onPress}
          accessibilityRole="button"
          accessibilityLabel={p.label}
          fill={false}
          style={[styles.pill, halves ? styles.half : null]}
          contentStyle={[styles.pillIn, surfaceStyle(pillSurface(scheme), PILL / 2)]}
        >
          <Icon name={p.icon} size={18} color={c.ink} />
          <Text variant="subhead" numberOfLines={1} style={styles.pillText}>
            {p.label}
          </Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 32 },
  grow: { flex: 1 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pressed: { opacity: 0.7 },
  // Four to a row; the room between rows is the tiles' own (their name under them, 8 below it).
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4, rowGap: 8 },
  cell: { width: "25%" },
  cellIn: { alignItems: "center", gap: 6, paddingTop: 4 },
  tile: { width: TILE, height: TILE, alignItems: "center", justifyContent: "center" },
  unpinned: { opacity: 0.6 },
  count: { position: "absolute", top: -4, right: -6 },
  pin: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { alignSelf: "stretch", textAlign: "center", fontWeight: "500" },
  section: { gap: 8, paddingTop: 4 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { flexGrow: 1 },
  half: { flexBasis: "40%" },
  pillIn: {
    minHeight: PILL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  pillText: { fontWeight: "600" },
});
