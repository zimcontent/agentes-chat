import type { PortalCardFile, PortalClientColor, PortalColumn, PortalState, PortalStatus } from "@agenteschat/client";
import { useApi } from "@agenteschat/client";
import { portalClientHue, portalClientInitials } from "@agenteschat/client/lib/portal";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Chip, Icon, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { ownSource } from "../review/media";
import { useColors, useOrgId, useWhen } from "../shared/hooks";
import { Tile } from "../shared/parts";
import { usePersonPhoto } from "../shared/photo";
import { usePortalWords } from "./hooks";
import { CLIENT_COLOR, coverOf, fileKind, STAGE_COLOR, STATUS_LOOK } from "./model";

/** Opens a client's board, one card, or one post at the portal no card stands for. */
export const openClient = (client: string) => router.push(`/portal/client/${encodeURIComponent(client)}`);
export const openCard = (client: string, cardId: string) =>
  router.push(`/portal/card/${encodeURIComponent(cardId)}?client=${encodeURIComponent(client)}`);
export const openPost = (client: string, itemId: string) =>
  router.push(`/portal/post/${encodeURIComponent(itemId)}?client=${encodeURIComponent(client)}`);

/**
 * A client's mark (ADR 9001 §13, §16), as the web draws it: the logo the team gave it, else its initials on its
 * colour, or on a hue of its name when it has none. A logo that fails to load falls back to the initials.
 */
export function ClientMark({
  client,
  logo,
  color,
  size = 40,
}: {
  client: string;
  logo?: string | null | undefined;
  color?: PortalClientColor | null | undefined;
  size?: number;
}) {
  const source = usePersonPhoto(logo ?? null);
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.3);
  if (source && !failed) {
    return (
      <Image
        source={source}
        onError={() => setFailed(true)}
        contentFit="cover"
        style={{ width: size, height: size, borderRadius: radius }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const paint = color ? CLIENT_COLOR[color] : null;
  const hue = portalClientHue(client);
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: paint?.bg ?? `hsla(${hue}, 55%, 50%, 0.2)`,
          borderColor: paint ? "transparent" : `hsla(${hue}, 55%, 50%, 0.35)`,
        },
      ]}
    >
      <Text variant="footnote" style={[styles.markText, paint ? { color: paint.ink } : null]}>
        {portalClientInitials(client)}
      </Text>
    </View>
  );
}

/** How many a group holds, at the end of its header's line. */
export function HeaderCount({ count }: { count: number }) {
  return (
    <Text variant="footnote" tone="faint" style={styles.count}>
      {String(count)}
    </Text>
  );
}

/** Where a piece of work is (ADR 9001 §8): the stage's word after a dot in its colour. Automatic: nobody types it. */
export function StageChip({ stage }: { stage: PortalColumn }) {
  const w = usePortalWords();
  return (
    <Chip
      label={stage === "posted" ? w.status.published : w.columns[stage]}
      leading={<View style={[styles.dot, { backgroundColor: STAGE_COLOR[stage] }]} />}
    />
  );
}

/** Where a post stands at the portal; only an adjustment asked waits on the team. */
export function StatusChip({ status }: { status: PortalStatus }) {
  const w = usePortalWords();
  const look = STATUS_LOOK[status];
  return <Chip icon={look.icon} tone={look.wait ? "wait" : "neutral"} label={w.status[status]} />;
}

/** A row's picture: the card's first picture, a play tile for a video, else the type's tile. */
export function CardCover({ files, size = 40 }: { files: readonly PortalCardFile[]; size?: number }) {
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  const cover = coverOf(files);
  if (cover?.kind === "image") {
    return (
      <Image
        source={ownSource(api.artifacts.fileUrl(orgId, cover.file.id))}
        style={{ width: size, height: Math.round(size * 1.25), borderRadius: 6, backgroundColor: c.sunken }}
        contentFit="cover"
        recyclingKey={cover.file.id}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return <Tile icon={cover?.kind === "video" ? "play" : "image"} size={size} />;
}

/** Room a strip's tile takes: a portrait post (4:5), as feeds show them. */
const STRIP_W = 132;
const STRIP_H = 165;

/**
 * A card's files side by side, pictures as they are and a video as a play tile; a press opens the file full screen
 * (the app's own viewer, which plays videos and zooms pictures).
 */
export function FileStrip({ files }: { files: readonly PortalCardFile[] }) {
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  if (files.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {files.map((file) => {
        const kind = fileKind(file);
        return (
          <Pressable
            key={file.id}
            onPress={() => router.push(`/file/${file.id}`)}
            accessibilityRole="imagebutton"
            accessibilityLabel={file.name}
            style={({ pressed }) => [styles.stripTile, { backgroundColor: c.sunken, opacity: pressed ? 0.8 : 1 }]}
          >
            {kind === "image" ? (
              <Image
                source={ownSource(api.artifacts.fileUrl(orgId, file.id))}
                style={styles.stripImage}
                contentFit="cover"
                recyclingKey={file.id}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={styles.stripOther}>
                <Icon name={kind === "video" ? "play" : "file"} size={28} color={c.muted} />
                <Text variant="caption" tone="muted" numberOfLines={2} style={styles.stripName}>
                  {file.name}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * While the portal doesn't answer, the server shows its last good read: one quiet line says so, with when, and how
 * many changes still wait to reach it.
 */
export function PortalNotice({ state }: { state: PortalState | undefined }) {
  const w = usePortalWords();
  const when = useWhen();
  if (!state || (!state.stale && state.queued === 0)) return null;
  const lines = [
    state.stale ? (state.readAt ? w.stale(when.short(state.readAt)) : w.staleNoTime) : null,
    state.queued > 0 ? w.queued(state.queued) : null,
  ].filter(Boolean);
  return (
    <Text variant="footnote" tone="muted" style={styles.notice}>
      {lines.join(" ")}
    </Text>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  markText: { fontWeight: "700", letterSpacing: 0.3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  strip: { gap: 8, paddingHorizontal: 16 },
  stripTile: { width: STRIP_W, height: STRIP_H, borderRadius: 12, overflow: "hidden" },
  stripImage: { width: STRIP_W, height: STRIP_H },
  stripOther: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 10 },
  stripName: { textAlign: "center" },
  notice: { paddingHorizontal: 16 },
  count: { paddingTop: 20, paddingBottom: 8, fontVariant: ["tabular-nums"] },
});
