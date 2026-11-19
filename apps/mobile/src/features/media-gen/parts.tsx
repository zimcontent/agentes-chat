import { type MediaGenerationView, modelBrand, useApi } from "@dougbot/client";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Icon, ProviderLogo, type ProviderLogoProps, Text } from "@/ui";
import { ownSource } from "../review/media";
import { useColors, useOrgId } from "../shared/hooks";
import { brandLogoId, tileLook } from "./logic";
import { useMediaWords } from "./words";

/** The maker's logo beside a model's name, as the web's picker shows it (`ModelMark`). */
export function ModelLogo({
  id,
  label,
  size = "chip",
}: {
  id: string;
  label: string;
  size?: ProviderLogoProps["size"];
}) {
  return <ProviderLogo id={brandLogoId(modelBrand(id, label), label)} size={size} />;
}

/**
 * One generation in the gallery, a square: the picture (its tile-sized copy), a video's first frame with a play mark,
 * or its state while it runs or after it failed. A tap opens the generation's screen.
 */
export function GenerationTile({ g, side, onPress }: { g: MediaGenerationView; side: number; onPress: () => void }) {
  const w = useMediaWords();
  const c = useColors();
  const look = tileLook(g);
  const label =
    look === "image" ? w.openImage(g.prompt) : look === "video" ? w.openVideo(g.prompt) : w.openGeneration(g.prompt);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        { width: side, height: side, backgroundColor: c.sunken },
        pressed && styles.pressed,
      ]}
    >
      {look === "image" && g.artifactId ? <Picture artifactId={g.artifactId} /> : null}
      {look === "video" && g.artifactId ? <Poster artifactId={g.artifactId} /> : null}
      {look === "running" || look === "failed" ? (
        <View style={styles.state}>
          {look === "running" ? <ActivityIndicator color={c.muted} /> : <Icon name="x" size={18} color={c.danger} />}
          <Text variant="caption" tone={look === "failed" ? "danger" : "muted"} numberOfLines={2} style={styles.center}>
            {look === "running" ? w.running : w.failedShort}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Picture({ artifactId }: { artifactId: string }) {
  const api = useApi();
  const orgId = useOrgId();
  return (
    <Image
      source={ownSource(api.artifacts.pictureUrl(orgId, artifactId, { size: "tile" }))}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      recyclingKey={artifactId}
    />
  );
}

/** A video's first frame: the player paused at its start, silent, with no controls (there is no poster file). */
function Poster({ artifactId }: { artifactId: string }) {
  const api = useApi();
  const orgId = useOrgId();
  const player = useVideoPlayer(ownSource(api.artifacts.fileUrl(orgId, artifactId)), (p) => {
    p.muted = true;
    p.loop = false;
  });
  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
      <View style={styles.play} pointerEvents="none">
        <Icon name="play" size={14} color="#fff" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  state: { alignItems: "center", justifyContent: "center", gap: 6, padding: 8 },
  center: { textAlign: "center" },
  // The play mark on a dark disc, legible on any frame.
  play: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
