import { type MediaGenerationView, useApi, useMediaOverview } from "@dougbot/client";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GroupedHeader, GroupedList, GroupedRow, SkeletonList, Text, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { encodeFileList } from "../files/logic";
import { VideoPlayer } from "../files/VideoPlayer";
import { ownSource } from "../review/media";
import { useColors, useDirectory, useOrgId, useWhen } from "../shared/hooks";
import { copyText, PushedHeader } from "../shared/parts";
import { useMediaGeneration } from "./hooks";
import { aspectRatioOf, tileLook } from "./logic";
import { openNewMedia } from "./nav";
import { ModelLogo } from "./parts";
import { useMediaWords } from "./words";

/** The tallest a picture stands on the screen, against its width: a tall one doesn't push the facts off it. */
const TALLEST = 1.25;

/**
 * One generation (`/media/<id>`): the picture or the video (a tap opens the app's own viewer, with save and share),
 * its state while it runs or why it failed, the prompt, the facts (model, quality, aspect, length, credits, who and
 * when), and "Usar este prompt", which opens the form with its choices.
 */
export function GenerationScreen({ id }: { id: string }) {
  const w = useMediaWords();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const orgId = useOrgId();
  const query = useMediaGeneration(orgId, id);
  const g = query.data;
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={w.detailTitle} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.in, { paddingBottom: 24 + insets.bottom }]}
      >
        {g ? (
          <Body g={g} />
        ) : query.isLoading ? (
          <SkeletonList rows={3} />
        ) : (
          <Text tone="muted" style={styles.centerText}>
            {query.error?.message === "media.off" ? w.off : w.notFound}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Body({ g }: { g: MediaGenerationView }) {
  const { t, i18n } = useTranslation();
  const w = useMediaWords();
  const c = useColors();
  const toast = useToast();
  const dir = useDirectory();
  const when = useWhen();
  const orgId = useOrgId();
  const overview = useMediaOverview(orgId);
  const model = overview.data?.models.find((m) => m.id === g.model);
  const label = model?.label ?? g.model;
  const look = tileLook(g);
  const who = g.agentId
    ? dir.nameOf({ type: "agent", id: g.agentId })
    : g.userId
      ? dir.nameOf({ type: "person", id: g.userId })
      : "";
  const copy = () =>
    void copyText(g.prompt).then((ok) =>
      toast(ok ? { title: w.copied, icon: "copy" } : { title: t("mobile.app.failed"), icon: "x" }),
    );
  const open = () => {
    if (!g.artifactId) return;
    if (look === "image")
      router.push({
        pathname: "/images",
        params: { files: encodeFileList([{ id: g.artifactId, version: 1 }]), at: "0" },
      });
    else router.push(`/file/${g.artifactId}`);
  };
  return (
    <>
      <Preview g={g} onOpen={open} />
      {look === "failed" ? (
        <GroupedList>
          <GroupedRow icon="x" danger label={g.error ?? t("mediaGen.failed")} labelLines={0} />
        </GroupedList>
      ) : null}
      <View>
        <GroupedHeader>{t("mediaGen.prompt")}</GroupedHeader>
        <View style={[styles.prompt, { backgroundColor: c.raised }]}>
          <Text selectable>{g.prompt}</Text>
        </View>
      </View>
      <GroupedList>
        <GroupedRow leading={<ModelLogo id={g.model} label={label} />} label={t("mediaGen.model")} value={label} />
        {g.options.quality ? (
          <GroupedRow icon="sparkle" label={t("mediaGen.quality")} value={g.options.quality} />
        ) : null}
        {g.options.aspect ? <GroupedRow icon="expand" label={t("mediaGen.aspect")} value={g.options.aspect} /> : null}
        {g.kind === "video" && g.options.seconds ? (
          <GroupedRow
            icon="clock"
            label={t("mediaGen.seconds")}
            value={t("mediaGen.secondsValue", { count: g.options.seconds })}
          />
        ) : null}
        <GroupedRow icon="wallet" label={w.credits} value={g.credits.toLocaleString(i18n.language)} />
        {who ? <GroupedRow icon={g.agentId ? "agent" : "person"} label={w.by} value={who} /> : null}
        <GroupedRow icon="calendar" label={w.when} value={`${when.day(g.createdAt)}, ${when.time(g.createdAt)}`} />
      </GroupedList>
      <GroupedList>
        {look === "image" || look === "video" ? <GroupedRow icon="eye" label={w.open} chevron onPress={open} /> : null}
        <GroupedRow icon="copy" label={w.copyPrompt} onPress={copy} />
        <GroupedRow
          icon="replay"
          label={w.reuse}
          chevron
          onPress={() => openNewMedia({ kind: g.kind, model: g.model, prompt: g.prompt })}
        />
      </GroupedList>
    </>
  );
}

/** The result at the screen's width: the picture in its own shape, the video in our player, or its state. */
function Preview({ g, onOpen }: { g: MediaGenerationView; onOpen: () => void }) {
  const { t } = useTranslation();
  const w = useMediaWords();
  const c = useColors();
  const api = useApi();
  const orgId = useOrgId();
  const { width: screen } = useWindowDimensions();
  const width = screen - 32;
  const look = tileLook(g);
  const ratio = aspectRatioOf(g.options.aspect) ?? 1;
  const height = Math.min(width * TALLEST, Math.round(width / ratio));
  if (look === "image" && g.artifactId)
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="imagebutton"
        accessibilityLabel={w.openImage(g.prompt)}
        style={[styles.box, { height, backgroundColor: c.sunken }]}
      >
        <Image
          source={ownSource(api.artifacts.pictureUrl(orgId, g.artifactId, { size: "view" }))}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={150}
        />
      </Pressable>
    );
  if (look === "video" && g.artifactId)
    return (
      <VideoPlayer
        source={ownSource(api.artifacts.fileUrl(orgId, g.artifactId))}
        name={g.prompt}
        width={width}
        onOpen={onOpen}
      />
    );
  if (look === "running")
    return (
      <View style={[styles.box, styles.state, { height: Math.min(height, width), backgroundColor: c.sunken }]}>
        <ActivityIndicator color={c.muted} />
        <Text tone="muted" style={styles.centerText}>
          {t(g.kind === "video" ? "mediaGen.runningVideo" : "mediaGen.runningImage")}
        </Text>
      </View>
    );
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  centerText: { textAlign: "center" },
  box: { borderRadius: 12, overflow: "hidden" },
  state: { alignItems: "center", justifyContent: "center", gap: 10, padding: 16 },
  prompt: { borderRadius: 12, padding: 16 },
});
