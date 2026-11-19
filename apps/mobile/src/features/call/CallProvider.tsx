import { keys, type LiveRoom, useApi, useMe } from "@dougbot/client";
import type { FloorAgent } from "@dougbot/client/lib/live-floor";
import { playSound } from "@dougbot/client/lib/sounds";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics, Icon, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { Face } from "../shared/Face";
import { useConnection, useDirectory, useOrgId } from "../shared/hooks";
import { elapsedText } from "./logic";
import { PhoneAgentCall } from "./phone-agent-call";
import { PhoneRoom } from "./phone-room";

/**
 * Voice calls in the phone app (docs/adr/doug-0006-live-voice.md, the phone app): the call on now (a room in a
 * conversation, or a call with one agent from its DM), the bar that keeps it in reach while the person moves around the
 * app, and the card that rings when someone calls them in (`live.ring`).
 */

export type ActiveCall =
  | { kind: "room"; call: PhoneRoom; channelId: string; title: string }
  | { kind: "agent"; call: PhoneAgentCall; channelId: string; title: string };

interface CallApi {
  current: ActiveCall | null;
  startRoom(
    channelId: string,
    title: string,
    agentIds: string[],
    options?: { topic?: string | null; invite?: string[] },
  ): void;
  callAgent(agentId: string, channelId: string, title: string): void;
  /** Leaves (or hangs up) the call on now. */
  hangUp(): void;
}

const CallContext = createContext<CallApi | null>(null);
export const useCalls = () => useContext(CallContext);

/** The app's language as speech engines name it ("pt-BR"). */
export function speechLanguage(lang: string) {
  if (lang.startsWith("pt")) return "pt-BR";
  return lang || "pt-BR";
}

const RING_MS = 45_000;

interface Ring {
  roomId: string;
  channelId: string;
  channelName: string | null;
  byName: string;
  byUserId: string;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const orgId = useOrgId();
  const me = useMe().data?.user.id ?? "";
  const connection = useConnection();
  const dir = useDirectory();
  const { i18n } = useTranslation();
  const [current, setCurrent] = useState<ActiveCall | null>(null);
  const [ring, setRing] = useState<Ring | null>(null);
  const names = useRef(dir.memberById);
  names.current = dir.memberById;
  const agents = useMemo<FloorAgent[]>(
    () => dir.agents.map((a) => ({ id: a.id, name: a.name, handle: a.handle })),
    [dir.agents],
  );
  const language = speechLanguage(i18n.language);

  const hangUp = useCallback(() => {
    if (!current) return;
    if (current.kind === "room") void current.call.leave();
    else void current.call.stop();
    setCurrent(null);
  }, [current]);

  const startRoom = useCallback<CallApi["startRoom"]>(
    (channelId, title, agentIds, options) => {
      if (current?.kind === "room" && current.channelId === channelId && current.call.getState().phase === "live") {
        router.push("/call");
        return;
      }
      if (current) hangUp();
      const call = new PhoneRoom({
        api,
        orgId,
        channelId,
        me,
        agents,
        connection,
        language,
        personName: (id) => names.current.get(id)?.name,
      });
      setCurrent({ kind: "room", call, channelId, title });
      void call.start(agentIds, options);
      router.push("/call");
    },
    [current, hangUp, api, orgId, me, agents, connection, language],
  );

  const callAgent = useCallback<CallApi["callAgent"]>(
    (agentId, channelId, title) => {
      if (current?.kind === "agent" && current.call.agentId === agentId && current.call.getState().phase !== "ended") {
        router.push("/call");
        return;
      }
      if (current) hangUp();
      const call = new PhoneAgentCall({ api, orgId, agentId, channelId, language });
      setCurrent({ kind: "agent", call, channelId, title });
      void call.start();
      router.push("/call");
    },
    [current, hangUp, api, orgId, language],
  );

  // A call that ended leaves the bar.
  const phase = useCallPhase(current);
  useEffect(() => {
    if (phase === "ended") setCurrent(null);
  }, [phase]);

  // A conversation's call starts, changes or ends: its header's button follows at once.
  const qc = useQueryClient();
  useEffect(
    () =>
      connection?.onUserEvent((e) => {
        const event = e as { type: string; room?: LiveRoom };
        if (event.type !== "live.room" || !event.room) return;
        const room = event.room;
        qc.setQueryData(keys.liveRoom(orgId, room.channelId), room.status === "live" ? room : null);
      }),
    [connection, qc, orgId],
  );

  // Someone called this person into a call: the card rings until they join, say no, or it gives up.
  useEffect(
    () =>
      connection?.onUserEvent((e) => {
        const event = e as { type: string; [key: string]: unknown };
        if (event.type !== "live.ring" || typeof event.channelId !== "string") return;
        setRing({
          roomId: String(event.roomId),
          channelId: event.channelId,
          channelName: typeof event.channelName === "string" ? event.channelName : null,
          byName: typeof event.byName === "string" ? event.byName : "",
          byUserId: typeof event.byUserId === "string" ? event.byUserId : "",
        });
      }),
    [connection],
  );

  const value = useMemo<CallApi>(
    () => ({ current, startRoom, callAgent, hangUp }),
    [current, startRoom, callAgent, hangUp],
  );
  const inThatCall = Boolean(ring && current?.kind === "room" && current.channelId === ring.channelId);
  return (
    <CallContext.Provider value={value}>
      {children}
      {current && phase !== "ended" ? <CallBar call={current} onHangUp={hangUp} /> : null}
      {ring && !inThatCall ? (
        <RingCard
          ring={ring}
          onClose={() => setRing(null)}
          onJoin={() => {
            setRing(null);
            router.push(chatHref(ring.channelId, null));
            startRoom(ring.channelId, ring.channelName ? `#${ring.channelName}` : "", []);
          }}
        />
      ) : null}
    </CallContext.Provider>
  );
}

const noop = () => () => {};

/** The call's phase, kept up to date (null with no call). */
export function useCallPhase(current: ActiveCall | null) {
  return useSyncExternalStore(
    current?.call.subscribe ?? noop,
    () => current?.call.getState().phase ?? null,
    () => current?.call.getState().phase ?? null,
  );
}

/** The room's or the agent call's state, kept up to date. */
export function useRoomState(call: PhoneRoom) {
  return useSyncExternalStore(call.subscribe, call.getState, call.getState);
}
export function useAgentCallState(call: PhoneAgentCall) {
  return useSyncExternalStore(call.subscribe, call.getState, call.getState);
}

export function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The pill is dark green in both themes: its words stay light. */
const BAR_INK = "#EDEDED";

/** This fork's own words for the call's pill, in Portuguese and English (any other language reads English). */
const BAR_WORDS = {
  pt: { call: "Ligação", back: "Voltar à ligação" },
  en: { call: "Call", back: "Back to the call" },
} as const;

/**
 * The call in reach while the person moves around the app (the look in docs/adr/doug-0016-doug-pinned.md): a dark
 * green pill under the status bar with the time, "Voltar à ligação" and a red button that hangs up there.
 */
function CallBar({ call, onHangUp }: { call: ActiveCall; onHangUp: () => void }) {
  const { t, i18n } = useTranslation();
  const w = BAR_WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useTick();
  const started = useSyncExternalStore(call.call.subscribe, () => call.call.getState().startedAt);
  const open = () => router.push("/call");
  return (
    <View style={[styles.bar, { top: insets.top + 4 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("liveVoice.room.open")}, ${call.title}`}
        onPress={open}
        style={styles.barMain}
      >
        <Icon name="handset" size={15} color={c.green} />
        <Text variant="footnote" style={[styles.barText, { color: BAR_INK }]} numberOfLines={1}>
          {`${call.title || w.call} · ${elapsedText(started, now)}`}
        </Text>
        <View style={styles.barBack}>
          <Text variant="footnote" style={[styles.barBackText, { color: BAR_INK }]} numberOfLines={1}>
            {w.back}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("liveVoice.agentCall.hangUp")}
        onPress={onHangUp}
        style={[styles.barHang, { backgroundColor: c.danger }]}
      >
        <View style={styles.down}>
          <Icon name="handset" size={15} color="#FFFFFF" />
        </View>
      </Pressable>
    </View>
  );
}

/** "Gabriel is calling you": rings for a while, with Join and Not now. */
function RingCard({ ring, onJoin, onClose }: { ring: Ring; onJoin: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors: c, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const name = dir.memberById.get(ring.byUserId)?.name ?? ring.byName;
  useEffect(() => {
    haptics.warning();
    playSound("attention");
    const again = setInterval(() => playSound("attention"), 4000);
    const stop = setTimeout(onClose, RING_MS);
    return () => {
      clearInterval(again);
      clearTimeout(stop);
    };
  }, [onClose]);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={t("liveVoice.ring.title", { name })}
      style={[styles.ring, { bottom: insets.bottom + 12, backgroundColor: c.raised, boxShadow: shadows.e2 }]}
    >
      <Face who={{ type: "person", id: ring.byUserId }} size={40} live={false} />
      <View style={styles.ringText}>
        <Text variant="subhead" numberOfLines={1}>
          {t("liveVoice.ring.title", { name })}
        </Text>
        <Text variant="footnote" tone="faint" numberOfLines={1}>
          {t("liveVoice.ring.where", { channel: ring.channelName ? `#${ring.channelName}` : "" })}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("liveVoice.ring.decline")}
        onPress={onClose}
        style={[styles.round, { backgroundColor: c.sunken }]}
      >
        <Icon name="x" size={20} color={c.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("liveVoice.ring.join")}
        onPress={onJoin}
        style={[styles.round, { backgroundColor: c.green }]}
      >
        <Icon name="handset" size={20} color={c.greenInk} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 42,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 21,
    backgroundColor: "#16240A",
    boxShadow: "inset 0px 0px 0px 1px rgba(156, 250, 5, 0.35), 0px 8px 24px -8px rgba(0, 0, 0, 0.6)",
  },
  barMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, height: 42 },
  barText: { flexShrink: 1, fontWeight: "600" },
  barBack: {
    marginLeft: "auto",
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  barBackText: { fontWeight: "600" },
  barHang: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  down: { transform: [{ rotate: "135deg" }] },
  ring: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 20,
  },
  ringText: { flex: 1, minWidth: 0 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
