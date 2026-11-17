import { Text as RNText, StyleSheet, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import type { AgentLookInput } from "@/agent/looks";
import { DB_FONTES } from "@/brand/tokens";
import { ISLAND_RIM, IslandGlass } from "@/features/island/IslandGlass";
import { brandBox, CAMERA, notchHeight, noticeClear, noticeTop, type TopKind } from "@/features/island/shape";
import { AgentAvatar, Assinatura, Text } from "@/ui";
import { useTheme } from "@/ui/theme";
import { Inicio } from "./telas";

/*
 * The island on the board: Início under it, the status bar and the phone's camera or notch drawn over it (as the
 * hardware is). At rest the island is DougBot's signature; with `notice` it has grown into an agent's notice, the
 * closed pill `NoticeIsland` draws (its numbers from `shape.ts`; the words are sample ones).
 */

const INSET: Record<TopKind, number> = { camera: 59, notch: 47, plain: 20 };
/** The notch of an iPhone 13 or 14. */
const NOTCH_W = 162;
const SONY: AgentLookInput = { color: "sky", eyes: "round", id: "SONY", name: "SONY", role: "Vídeo" };

export function IlhaCena({ kind, notice = false }: { kind: TopKind; notice?: boolean }) {
  const inset = INSET[kind];
  return (
    <Inicio
      topInset={inset}
      scrolledBy={36}
      over={
        <>
          {/* The status bar steps aside while a notice covers its line. */}
          {notice ? null : <StatusBar kind={kind} />}
          <Island kind={kind} inset={inset} notice={notice} />
          <Hardware kind={kind} inset={inset} />
        </>
      }
    />
  );
}

function Island({ kind, inset, notice }: { kind: TopKind; inset: number; notice: boolean }) {
  const dim = useSharedValue(notice ? 1 : 0);
  const brand = brandBox(kind, inset);
  const clear = noticeClear(kind, inset);
  const box = notice
    ? { top: noticeTop(kind, inset), w: "100%" as const, h: 72 + clear, corner: 36 }
    : { top: brand.top, w: brand.w, h: brand.h, corner: brand.corner };
  return (
    <View pointerEvents="none" style={[styles.place, { top: box.top }, notice ? styles.wide : null]}>
      <View
        style={[
          styles.island,
          { width: box.w, height: box.h, borderRadius: box.corner },
          kind === "notch" ? styles.squareTop : null,
        ]}
      >
        <IslandGlass dim={dim} />
        {notice ? (
          <View style={[styles.pill, { paddingTop: clear }]}>
            <AgentAvatar agent={SONY} size={40} name="SONY" />
            <View style={styles.grow}>
              <Text variant="subhead" numberOfLines={1} style={styles.muted}>
                <Text variant="subhead" style={styles.names}>
                  SONY
                </Text>{" "}
                pediu sua aprovação
              </Text>
              <Text variant="subhead" numberOfLines={1} style={styles.white}>
                Publicar o corte 3 no Reels?
              </Text>
            </View>
            <View style={styles.chip}>
              <Text variant="subhead" style={styles.chipText}>
                Ver
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.brand, { paddingTop: brand.clear }]}>
            <Assinatura size={15} color="#EDEDED" />
          </View>
        )}
      </View>
    </View>
  );
}

/** The phone's own black: the camera's island, or the notch. */
function Hardware({ kind, inset }: { kind: TopKind; inset: number }) {
  if (kind === "camera")
    return (
      <View
        style={[
          styles.hw,
          {
            top: CAMERA.top,
            width: CAMERA.width,
            height: CAMERA.height,
            borderRadius: CAMERA.height / 2,
          },
        ]}
      />
    );
  if (kind === "notch")
    return (
      <View
        style={[
          styles.hw,
          {
            top: 0,
            width: NOTCH_W,
            height: notchHeight(inset),
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
          },
        ]}
      />
    );
  return null;
}

/** The time and the battery, beside the camera or the notch. */
function StatusBar({ kind }: { kind: TopKind }) {
  const { colors } = useTheme();
  const top = kind === "camera" ? 18 : 14;
  const ink = { color: colors.ink, fontFamily: DB_FONTES.texto600, fontSize: 17, fontWeight: "600" as const };
  return (
    <View pointerEvents="none" style={[styles.status, { top }]}>
      <RNText style={ink}>9:41</RNText>
      <View style={[styles.battery, { borderColor: colors.ink }]}>
        <View style={[styles.batteryFill, { backgroundColor: colors.ink }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  // The closed notice: the screen less 10 a side, as the app's (`width - 20`, at most 420).
  wide: { paddingHorizontal: 10 },
  island: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: ISLAND_RIM },
  squareTop: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  brand: { flex: 1, alignItems: "center", justifyContent: "center" },
  pill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 18 },
  grow: { flex: 1, minWidth: 0 },
  muted: { color: "rgba(255,255,255,0.64)" },
  names: { color: "#fff", fontWeight: "600" },
  white: { color: "#fff" },
  chip: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  chipText: { color: "#fff", fontWeight: "600" },
  hw: { position: "absolute", left: 0, right: 0, marginHorizontal: "auto", backgroundColor: "#000" },
  status: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 44,
  },
  battery: { width: 25, height: 12, borderRadius: 4, borderWidth: 1, padding: 1.5, opacity: 0.9 },
  batteryFill: { flex: 1, borderRadius: 2 },
});
