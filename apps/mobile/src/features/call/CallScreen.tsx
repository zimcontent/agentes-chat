import { errorText } from "@dougbot/client/lib/errors";
import type { Who } from "@dougbot/client/lib/live-host";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconButton, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { AgentFace, Face } from "../shared/Face";
import { useDirectory, useMeId } from "../shared/hooks";
import { goBack } from "../shared/parts";
import { AgentCallView, CallAction } from "./AgentCallView";
import { type ActiveCall, useAgentCallState, useCalls, useRoomState, useTick } from "./CallProvider";
import { elapsedText, phoneHostsOthers, tilesOf } from "./logic";
import type { PhoneAgentCall } from "./phone-agent-call";
import type { PhoneRoom } from "./phone-room";
import type { CallRoute } from "./route";

/**
 * The call, full screen (docs/adr/doug-0006-live-voice.md, the phone app): who is on it (the one talking lit), who has
 * the word, the latest captions, and the call's buttons: microphone, "modo telefone" or "viva voz", call someone in,
 * and leave. "Minimizar" goes back to the app with the call on (its bar at the top).
 */
export function CallScreen() {
  const calls = useCalls();
  const current = calls?.current;
  if (!current) return <Gone />;
  return current.kind === "room" ? (
    <RoomView call={current.call} active={current} />
  ) : (
    <AgentView call={current.call} active={current} />
  );
}

function Gone() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
      <Text variant="body" tone="faint">
        {t("liveVoice.room.ended")}
      </Text>
      <View style={{ height: 16 }} />
      <IconButton icon="back" label={t("common.close")} plate onPress={goBack} />
    </View>
  );
}

function Top({ title, since, onMinimize }: { title: string; since: number; onMinimize: () => void }) {
  const { t } = useTranslation();
  const now = useTick();
  return (
    <View style={styles.top}>
      <IconButton icon="down" label={t("liveVoice.room.minimize")} plate onPress={onMinimize} />
      <View style={styles.topText}>
        <Text variant="subhead" numberOfLines={1} style={styles.centerText}>
          {title || t("liveVoice.room.title")}
        </Text>
        <Text variant="footnote" tone="faint" style={[styles.centerText, { fontVariant: ["tabular-nums"] }]}>
          {elapsedText(since, now)}
        </Text>
      </View>
      <View style={styles.side} />
    </View>
  );
}

function RouteAction({ route, onChange }: { route: CallRoute; onChange: (r: CallRoute) => void }) {
  const { t } = useTranslation();
  const speaker = route === "speaker";
  return (
    <CallAction
      icon={speaker ? "sound" : "phone"}
      on={speaker}
      word={speaker ? t("liveVoice.phone.speaker") : t("liveVoice.phone.earpiece")}
      label={speaker ? t("liveVoice.phone.toEarpiece") : t("liveVoice.phone.toSpeaker")}
      onPress={() => onChange(speaker ? "earpiece" : "speaker")}
    />
  );
}

function RoomView({ call, active }: { call: PhoneRoom; active: ActiveCall }) {
  const { t, i18n } = useTranslation();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const calls = useCalls();
  const s = useRoomState(call);
  const me = useMeId() ?? "";
  const dir = useDirectory();
  const tiles = tilesOf(s.room, me);
  const hostNote = phoneHostsOthers(s.room, me);
  const captions = s.captions.slice(-3);
  const leave = () => {
    const alone = (s.room?.people.length ?? 1) <= 1;
    if (alone) {
      calls?.hangUp();
      goBack();
      return;
    }
    Alert.alert(t("liveVoice.room.leave"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("liveVoice.room.endAll"),
        style: "destructive",
        onPress: () => {
          void call.endForAll();
          goBack();
        },
      },
      {
        text: t("liveVoice.room.leave"),
        onPress: () => {
          calls?.hangUp();
          goBack();
        },
      },
    ]);
  };
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <Top title={active.title} since={s.startedAt} onMinimize={goBack} />
      {s.phase === "failed" ? (
        <View style={[styles.flex, styles.center]}>
          <Text variant="body" style={styles.centerText}>
            {t("liveVoice.room.failed")}
          </Text>
          <Text variant="footnote" tone="faint" style={styles.centerText}>
            {errorText(t, s.error, i18n.language)}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.grid}>
          {tiles.map((who) => (
            <Tile
              key={who}
              who={who}
              name={who === `person:${me}` ? t("liveVoice.you") : dir.nameOf(toRef(who))}
              level={s.levels[who] ?? 0}
              holder={s.holder}
              voice={who.startsWith("agent:") ? s.agentVoices[who.slice(6)] : undefined}
              working={who.startsWith("agent:") && Boolean(s.working[who.slice(6)])}
              muted={who === `person:${me}` && !s.micOn}
              onPress={
                who.startsWith("agent:") ? () => call.give(s.holder === who.slice(6) ? null : who.slice(6)) : undefined
              }
            />
          ))}
        </ScrollView>
      )}
      {hostNote ? (
        <Text variant="footnote" tone="faint" style={[styles.note, styles.centerText]}>
          {t("liveVoice.phone.hostNote")}
        </Text>
      ) : null}
      <View style={styles.captions} accessibilityLiveRegion="polite">
        {s.holder ? (
          <Text variant="footnote" tone="faint" style={styles.centerText}>
            {t("liveVoice.room.hasWord", { name: dir.nameOf({ type: "agent", id: s.holder }) })}
          </Text>
        ) : null}
        {captions.map((cap) => (
          <Text
            key={cap.n}
            variant="callout"
            numberOfLines={2}
            style={[styles.centerText, cap.live ? null : { color: c.muted }]}
          >
            <Text variant="callout" style={{ fontWeight: "600" }}>
              {cap.who === `person:${me}` ? t("liveVoice.you") : dir.nameOf(toRef(cap.who))}:{" "}
            </Text>
            {cap.text}
          </Text>
        ))}
      </View>
      <View style={styles.actions}>
        <CallAction
          icon={s.micOn ? "mic" : "micOff"}
          on={!s.micOn}
          word={s.micOn ? t("liveVoice.phone.mic") : t("liveVoice.room.muted")}
          label={s.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
          onPress={() => call.toggleMic()}
        />
        <RouteAction route={s.route} onChange={(r) => call.setRoute(r)} />
        <CallAction
          icon="members"
          word={t("liveVoice.phone.callIn")}
          label={t("liveVoice.room.invite")}
          onPress={() => router.push("/call-invite")}
        />
        <CallAction
          icon="handset"
          danger
          word={t("liveVoice.phone.leave")}
          label={t("liveVoice.room.leave")}
          onPress={leave}
        />
      </View>
    </View>
  );
}

function AgentView({ call, active }: { call: PhoneAgentCall; active: ActiveCall }) {
  const { t, i18n } = useTranslation();
  const calls = useCalls();
  const s = useAgentCallState(call);
  const now = useTick();
  const dir = useDirectory();
  const name = dir.nameOf({ type: "agent", id: call.agentId });
  return (
    <AgentCallView
      name={active.title || name}
      face={(size) => <AgentFace agentId={call.agentId} size={size} mode={s.level > 0.1 ? "run" : "idle"} />}
      since={elapsedText(s.startedAt, now)}
      connecting={s.phase === "connecting"}
      failed={s.phase === "failed" ? errorText(t, s.error, i18n.language) : null}
      level={s.level}
      caption={s.caption}
      micOn={s.micOn}
      speaker={s.route === "speaker"}
      onMinimize={goBack}
      onMic={() => call.toggleMic()}
      onSpeaker={() => call.setRoute(s.route === "speaker" ? "earpiece" : "speaker")}
      // Writing goes back to the conversation with the call still on (its bar on top).
      onWrite={goBack}
      onHangUp={() => {
        calls?.hangUp();
        goBack();
      }}
      hangUpWord={t("liveVoice.agentCall.hangUp")}
      micWords={{
        on: t("liveVoice.phone.mic"),
        off: t("liveVoice.room.muted"),
        turnOff: t("liveVoice.room.micOff"),
        turnOn: t("liveVoice.room.micOn"),
      }}
      speakerWords={{
        speaker: t("liveVoice.phone.speaker"),
        earpiece: t("liveVoice.phone.earpiece"),
        toSpeaker: t("liveVoice.phone.toSpeaker"),
        toEarpiece: t("liveVoice.phone.toEarpiece"),
      }}
      minimizeLabel={t("liveVoice.room.minimize")}
    />
  );
}

const toRef = (who: Who) => {
  const [type, id] = who.split(":") as ["person" | "agent", string];
  return { type, id };
};

/** A ring around a face that grows with how loud it is. */
function Glow({
  level,
  size,
  lit,
  children,
}: {
  level: number;
  size: number;
  lit?: boolean;
  children: React.ReactNode;
}) {
  const { colors: c } = useTheme();
  const width = 2 + Math.round(level * 6);
  const on = lit || level > 0.08;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        borderWidth: width,
        borderColor: on ? c.green : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

function Tile({
  who,
  name,
  level,
  holder,
  voice,
  working,
  muted,
  onPress,
}: {
  who: Who;
  name: string;
  level: number;
  holder: string | null;
  voice?: "connecting" | "live" | "failed";
  working: boolean;
  muted: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const ref = toRef(who);
  const agent = ref.type === "agent";
  const hasWord = agent && holder === ref.id;
  const line = muted
    ? t("liveVoice.room.muted")
    : working
      ? t("liveVoice.room.working")
      : voice === "connecting"
        ? t("liveVoice.room.connecting")
        : voice === "failed"
          ? t("liveVoice.room.voiceFailed")
          : hasWord
            ? t("liveVoice.room.word")
            : "";
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[
        name,
        line,
        onPress ? (hasWord ? t("liveVoice.room.takeWord") : t("liveVoice.room.giveWord")) : "",
      ]
        .filter(Boolean)
        .join(", ")}
      style={styles.tile}
    >
      <Glow level={level} size={92} lit={hasWord}>
        {agent ? (
          <AgentFace agentId={ref.id} size={76} mode={working ? "think" : level > 0.1 ? "run" : "idle"} />
        ) : (
          <Face who={ref} size={76} live={false} />
        )}
      </Glow>
      <Text variant="footnote" numberOfLines={1} style={styles.centerText}>
        {name}
      </Text>
      <Text variant="caption" tone="faint" numberOfLines={1} style={styles.centerText}>
        {line || " "}
      </Text>
      {muted ? (
        <View style={styles.mutedMark}>
          <Icon name="micOff" size={14} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  topText: { flex: 1, minWidth: 0 },
  side: { width: 40 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16, paddingVertical: 24 },
  tile: { width: 104, alignItems: "center", gap: 4 },
  mutedMark: { position: "absolute", top: 4, right: 8 },
  note: { paddingHorizontal: 12, paddingBottom: 8 },
  captions: { minHeight: 72, gap: 4, paddingHorizontal: 8, paddingBottom: 16, justifyContent: "flex-end" },
  agentCaption: { marginTop: 24, paddingHorizontal: 12 },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  action: { alignItems: "center", gap: 6, width: 76 },
  actionButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
});
