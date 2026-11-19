import type { Agent, Message } from "@dougbot/client";
import { useApi, useChannelLiveRoom, useLiveVoice } from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import type { FloorAgent } from "@dougbot/client/lib/live-floor";
import { can } from "@dougbot/client/lib/permissions";
import { playSound } from "@dougbot/client/lib/sounds";
import { Avatar, Button, Checkbox, Dialog, DialogBody, DialogFooter, Icon, Textarea } from "@dougbot/ui";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useRealtimeConnection } from "@/realtime/context";
import { AgentCall } from "./agent-call";
import { CaptionsIcon, HandsetIcon, MicOffIcon } from "./icons";
import { ListenCall } from "./listen";
import { VoicePreview } from "./preview";
import { type Caption, RoomCall, type Who } from "./room";
import "./live-voice.css";

/*
 * Live voice in the web app (ADR doug-0006): a voice room per conversation, laid out like a video meeting (a tile per
 * person and agent, the one speaking lit), that keeps going while the person moves around the app (it shrinks to a
 * pill); and "Ouvir" on a message, a small bar while the voice tells it.
 */

interface ListenSession {
  call: ListenCall;
  agentId: string | null;
  name: string;
}

interface LiveVoiceApi {
  /** Calls with agents and Ouvir work in this workspace (a GPT-Live key). */
  available: boolean;
  room: RoomCall | null;
  roomChannel: string | null;
  startRoom(
    channelId: string,
    agentIds: string[],
    title: string,
    options?: { topic?: string | null; invite?: string[] },
  ): void;
  /** A call with one agent from its conversation (as the Nordus call): the agent works behind its voice. */
  callAgent(agentId: string, channelId: string): void;
  agentCall: AgentCall | null;
  listen(message: Message): void;
  /** The voice picker's previews: an agent saying hello in a voice. */
  preview: VoicePreview;
}

const LiveVoiceContext = createContext<LiveVoiceApi | null>(null);
export const useLiveVoiceActions = () => useContext(LiveVoiceContext);

/** The app's language as speech engines name it ("pt-BR"). */
function speechLanguage(lang: string) {
  if (lang === "pt" || lang.startsWith("pt")) return "pt-BR";
  return lang || "pt-BR";
}

export function LiveVoiceProvider({ children }: { children: ReactNode }) {
  const { org, me } = useOrg();
  const api = useApi();
  const { i18n } = useTranslation();
  const connection = useRealtimeConnection();
  const dir = useDirectory(org.id);
  const status = useLiveVoice(org.id);
  const [room, setRoom] = useState<{ call: RoomCall; channelId: string; title: string; n: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [listen, setListen] = useState<ListenSession | null>(null);
  const [agentCall, setAgentCall] = useState<{ call: AgentCall; agentId: string; n: number } | null>(null);
  const language = speechLanguage(i18n.language);
  const floorAgents = useMemo<FloorAgent[]>(
    () => [...dir.agentById.values()].map((a) => ({ id: a.id, name: a.name, handle: a.handle })),
    [dir.agentById],
  );
  const names = useRef(dir.memberById);
  names.current = dir.memberById;

  const startRoom = useCallback(
    (channelId: string, agentIds: string[], title: string, options?: { topic?: string | null; invite?: string[] }) => {
      setMinimized(false);
      if (room && room.channelId === channelId && room.call.getState().phase === "live") return;
      void room?.call.leave();
      const call = new RoomCall({
        api,
        orgId: org.id,
        channelId,
        me: me.user.id,
        agents: floorAgents,
        connection,
        language,
      });
      call.personName = (id) => names.current.get(id)?.name;
      setRoom((was) => ({ call, channelId, title, n: (was?.n ?? 0) + 1 }));
      void call.start(agentIds, options);
    },
    [room, api, org.id, me.user.id, floorAgents, connection, language],
  );

  const callAgent = useCallback(
    (agentId: string, channelId: string) => {
      if (agentCall && agentCall.agentId === agentId && agentCall.call.getState().phase !== "ended") return;
      void agentCall?.call.stop();
      void listen?.call.stop();
      const call = new AgentCall({ api, orgId: org.id, agentId, channelId, language });
      setAgentCall((was) => ({ call, agentId, n: (was?.n ?? 0) + 1 }));
      void call.start();
    },
    [agentCall, listen, api, org.id, language],
  );

  const startListen = useCallback(
    (session: Omit<ListenSession, "call">, options: ConstructorParameters<typeof ListenCall>[0]) => {
      void listen?.call.stop();
      const call = new ListenCall(options);
      setListen({ ...session, call });
      void call.start();
    },
    [listen],
  );

  // Someone called this person into a call: their app rings until they join, say no, or it gives up.
  const [ring, setRing] = useState<Ring | null>(null);
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

  const preview = useMemo(() => new VoicePreview({ api, orgId: org.id, language }), [api, org.id, language]);
  useEffect(() => () => preview.stop(), [preview]);

  const value = useMemo<LiveVoiceApi>(
    () => ({
      available: status.data?.state === "ok",
      room: room?.call ?? null,
      roomChannel: room?.channelId ?? null,
      startRoom,
      callAgent,
      agentCall: agentCall?.call ?? null,
      listen: (message) => {
        const agent = message.author.type === "agent" ? dir.agentById.get(message.author.id ?? "") : undefined;
        const person = message.author.type === "person" ? dir.memberById.get(message.author.id ?? "") : undefined;
        startListen(
          { agentId: agent?.id ?? null, name: agent?.name ?? person?.name ?? "" },
          { api, orgId: org.id, kind: "listen", messageId: message.id, language },
        );
      },
      preview,
    }),
    [
      status.data?.state,
      room,
      startRoom,
      callAgent,
      agentCall,
      startListen,
      preview,
      dir.agentById,
      dir.memberById,
      api,
      org.id,
      language,
    ],
  );

  return (
    <LiveVoiceContext.Provider value={value}>
      {children}
      {room && (
        <RoomStage
          key={room.n}
          call={room.call}
          title={room.title}
          minimized={minimized}
          onMinimize={setMinimized}
          onClose={() => setRoom(null)}
        />
      )}
      {ring && (
        <IncomingCall
          ring={ring}
          inCall={room?.channelId === ring.channelId && room.call.getState().phase === "live"}
          onJoin={() => {
            setRing(null);
            startRoom(ring.channelId, [], ring.channelName ? `#${ring.channelName}` : "");
          }}
          onClose={() => setRing(null)}
        />
      )}
      {listen && <ListenBar session={listen} onClose={() => setListen(null)} />}
      {agentCall && (
        <AgentCallBar
          key={agentCall.n}
          call={agentCall.call}
          agentId={agentCall.agentId}
          onClose={() => setAgentCall(null)}
        />
      )}
    </LiveVoiceContext.Provider>
  );
}

// ── The room ──────────────────────────────────────────────────────────────────

function useCall(call: RoomCall) {
  return useSyncExternalStore(call.subscribe, call.getState);
}

function elapsed(since: string | undefined, now: number) {
  if (!since) return "0:00";
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Writes how loud `who` is into the tile's `--lv-level` each frame: the glow follows the voice without re-renders. */
function useGlow(call: RoomCall | ListenCall | AgentCall, who: Who | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const level = who ? (call instanceof RoomCall ? call.level(who) : call.loudness()) : 0;
      const el = ref.current;
      if (el) {
        el.style.setProperty("--lv-level", level.toFixed(3));
        el.toggleAttribute("data-speaking", level > 0.08);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [call, who]);
  return ref;
}

function RoomStage({
  call,
  title,
  minimized,
  onMinimize,
  onClose,
}: {
  call: RoomCall;
  /** The conversation's name, as its header says it. */
  title: string;
  minimized: boolean;
  onMinimize: (on: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const state = useCall(call);
  const now = useNow();
  const [captionsOn, setCaptionsOn] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [inviting, setInviting] = useState(false);
  const room = state.room;
  const people = room?.people.map((p) => p.userId) ?? [me.user.id];
  const ordered = [me.user.id, ...people.filter((u) => u !== me.user.id)];
  const agents = (room?.agentIds ?? []).flatMap((id) => {
    const a = dir.agentById.get(id);
    return a ? [a] : [];
  });
  const host = room?.hostUserId === me.user.id;
  const nameOf = (who: Who) => {
    const [type, id] = who.split(":");
    if (type === "agent") return dir.agentById.get(id ?? "")?.name ?? "";
    return id === me.user.id ? t("liveVoice.you") : (dir.memberById.get(id ?? "")?.name ?? "");
  };

  if (state.phase === "ended" || state.phase === "failed") {
    return createPortal(
      <div className="lv-stage lv-stage--done" role="dialog" aria-modal="true" aria-label={t("liveVoice.room.title")}>
        <div className="lv-done">
          {state.phase === "failed" ? <Icon name="alert" /> : <HandsetIcon hangUp />}
          <h2>{state.phase === "failed" ? t("liveVoice.room.failed") : t("liveVoice.room.ended")}</h2>
          <p>
            {state.phase === "failed"
              ? errorText(t, state.error)
              : room?.reportMessageId || (room?.lines.length ?? 0) > 1
                ? t("liveVoice.room.report")
                : t("liveVoice.room.noNotes")}
          </p>
          <Button variant="primary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>,
      document.body,
    );
  }

  if (minimized) {
    return createPortal(
      <section className="lv-pill" aria-label={t("liveVoice.room.title")}>
        <span className="lv-pill__dot" aria-hidden="true" />
        <span className="lv-pill__text">
          {t("liveVoice.room.inCall")} · {elapsed(room?.startedAt, now)}
        </span>
        <button
          type="button"
          className="lv-round lv-round--sm"
          data-off={!state.micOn || undefined}
          aria-label={state.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
          aria-pressed={!state.micOn}
          onClick={() => call.toggleMic()}
        >
          {state.micOn ? <Icon name="mic" /> : <MicOffIcon />}
        </button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon="expand"
          aria-label={t("liveVoice.room.open")}
          onClick={() => onMinimize(false)}
        />
        <button
          type="button"
          className="lv-round lv-round--sm lv-round--leave"
          aria-label={t("liveVoice.room.leave")}
          title={t("liveVoice.room.leave")}
          onClick={() => void call.leave()}
        >
          <HandsetIcon hangUp />
        </button>
      </section>,
      document.body,
    );
  }

  const tiles = ordered.length + agents.length;
  const columns = tiles <= 1 ? 1 : tiles <= 4 ? 2 : tiles <= 9 ? 3 : 4;
  const recent = captionsOn ? state.captions.filter((c) => now - c.at < 9000).slice(-2) : [];

  return createPortal(
    <div className="lv-stage" role="dialog" aria-modal="true" aria-label={t("liveVoice.room.title")}>
      <header className="lv-top">
        <span className="lv-top__title">
          {title || t("liveVoice.room.title")}
          <span className="lv-top__time">{elapsed(room?.startedAt, now)}</span>
        </span>
        <span className="lv-top__acts">
          {state.phase === "joining" && <span className="lv-top__note">{t("liveVoice.room.joining")}</span>}
          {room && (
            <Button
              size="sm"
              variant="ghost"
              icon="personAdd"
              aria-label={t("liveVoice.room.invite")}
              title={t("liveVoice.room.invite")}
              onClick={() => setInviting(true)}
            >
              {t("liveVoice.room.invite")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="fullscreenExit"
            aria-label={t("liveVoice.room.minimize")}
            title={t("liveVoice.room.minimize")}
            onClick={() => onMinimize(true)}
          />
        </span>
      </header>
      <div className="lv-grid" style={{ ["--lv-cols" as string]: columns }}>
        {ordered.map((userId) => {
          const person = dir.memberById.get(userId);
          return (
            <Tile
              key={userId}
              call={call}
              who={`person:${userId}`}
              name={userId === me.user.id ? t("liveVoice.you") : (person?.name ?? "")}
              muted={userId === me.user.id && !state.micOn}
              face={<Avatar name={person?.name ?? ""} imageUrl={person?.image ?? undefined} size="xl" />}
            />
          );
        })}
        {agents.map((agent) => (
          <Tile
            key={agent.id}
            call={call}
            who={`agent:${agent.id}`}
            name={agent.name}
            role={agent.role}
            holder={state.holder === agent.id}
            working={state.working[agent.id]}
            voice={host ? state.agentVoices[agent.id] : undefined}
            face={<AgentAvatar agentId={agent.id} name={agent.name} size="xl" />}
            onGive={() => call.give(state.holder === agent.id ? null : agent.id)}
          />
        ))}
      </div>
      <div className="lv-captions" aria-live="polite">
        {recent.map((c: Caption) => (
          <p
            key={c.n ?? `${c.who}-${c.at}`}
            className={c.live ? "lv-captions__line lv-captions__line--live" : "lv-captions__line"}
          >
            <b>{nameOf(c.who)}</b> {c.text}
          </p>
        ))}
      </div>
      <footer className="lv-bar">
        <span className="lv-bar__side">
          {state.holder
            ? t("liveVoice.room.hasWord", { name: dir.agentById.get(state.holder)?.name ?? "" })
            : agents.length
              ? t("liveVoice.room.agentsListen")
              : ""}
        </span>
        <span className="lv-bar__main">
          <button
            type="button"
            className="lv-round"
            data-off={!state.micOn || undefined}
            aria-pressed={!state.micOn}
            aria-label={state.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
            title={state.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
            onClick={() => call.toggleMic()}
          >
            {state.micOn ? <Icon name="mic" /> : <MicOffIcon />}
          </button>
          <button
            type="button"
            className="lv-round"
            data-on={captionsOn || undefined}
            aria-pressed={captionsOn}
            aria-label={t("liveVoice.room.captions")}
            title={t("liveVoice.room.captions")}
            onClick={() => setCaptionsOn((v) => !v)}
          >
            <CaptionsIcon />
          </button>
          {agents.length > 0 && (
            <button
              type="button"
              className="lv-round"
              disabled={!state.holder}
              aria-label={t("liveVoice.room.quiet")}
              title={t("liveVoice.room.quiet")}
              onClick={() => call.give(null)}
            >
              <Icon name="pause" />
            </button>
          )}
          <button
            type="button"
            className="lv-round lv-round--leave"
            aria-label={t("liveVoice.room.leave")}
            title={t("liveVoice.room.leave")}
            onClick={() => void call.leave()}
          >
            <HandsetIcon hangUp />
          </button>
        </span>
        <span className="lv-bar__side lv-bar__side--end">
          {room && (
            <Button size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>
              {t("liveVoice.room.endAll")}
            </Button>
          )}
        </span>
      </footer>
      {inviting && <InviteDialog call={call} onClose={() => setInviting(false)} />}
      <Dialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={t("liveVoice.room.endTitle")}
        description={t("liveVoice.room.endText")}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button onClick={() => setConfirmEnd(false)}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmEnd(false);
              void call.endForAll();
            }}
          >
            {t("liveVoice.room.endAll")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>,
    document.body,
  );
}

function Tile({
  call,
  who,
  name,
  role,
  face,
  muted,
  holder,
  working,
  voice,
  onGive,
}: {
  call: RoomCall;
  who: Who;
  name: string;
  role?: string;
  face: ReactNode;
  muted?: boolean;
  holder?: boolean;
  /** Working on something asked during the call. */
  working?: boolean;
  voice?: "connecting" | "live" | "failed";
  onGive?: () => void;
}) {
  const { t } = useTranslation();
  const ref = useGlow(call, who);
  return (
    <div ref={ref} className="lv-tile" data-holder={holder || undefined} data-voice={voice}>
      <div className="lv-tile__face">{face}</div>
      <div className="lv-tile__name">
        {muted && (
          <span className="lv-tile__muted" role="img" aria-label={t("liveVoice.room.muted")}>
            <MicOffIcon />
          </span>
        )}
        <span>{name}</span>
        {role && <span className="lv-tile__role">{role}</span>}
      </div>
      {holder && <span className="lv-tile__chip">{t("liveVoice.room.word")}</span>}
      {working && !holder && <span className="lv-tile__chip lv-tile__chip--muted">{t("liveVoice.room.working")}</span>}
      {voice === "connecting" && (
        <span className="lv-tile__chip lv-tile__chip--muted">{t("liveVoice.room.connecting")}</span>
      )}
      {voice === "failed" && (
        <span className="lv-tile__chip lv-tile__chip--bad">{t("liveVoice.room.voiceFailed")}</span>
      )}
      {onGive && (
        <button type="button" className="lv-tile__give" onClick={onGive}>
          {holder ? t("liveVoice.room.takeWord") : t("liveVoice.room.giveWord")}
        </button>
      )}
    </div>
  );
}

// ── Ouvir ─────────────────────────────────────────────────────────────────────

function ListenBar({ session, onClose }: { session: ListenSession; onClose: () => void }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session.call.subscribe, session.call.getState);
  const ref = useGlow(session.call, "agent:listen");
  useEffect(() => {
    if (state.phase !== "ended") return;
    const timer = setTimeout(onClose, 1200);
    return () => clearTimeout(timer);
  }, [state.phase, onClose]);
  const line =
    state.phase === "failed"
      ? errorText(t, state.error)
      : state.phase === "connecting"
        ? t("liveVoice.listen.connecting")
        : state.phase === "ended" || state.phase === "waiting"
          ? t("liveVoice.listen.done")
          : state.asking
            ? t("liveVoice.listen.asking")
            : t("liveVoice.listen.telling", { name: session.name || t("liveVoice.listen.narrator") });
  return createPortal(
    <div className="lv-listen" role="status">
      <div ref={ref} className="lv-listen__face">
        {session.agentId ? (
          <AgentAvatar agentId={session.agentId} name={session.name} size="sm" />
        ) : (
          <Icon name="sound" />
        )}
      </div>
      <span className="lv-listen__text">{line}</span>
      {state.phase !== "failed" && state.phase !== "ended" && !state.asking && (
        <Button size="sm" variant="ghost" icon="mic" onClick={() => void session.call.ask()}>
          {t("liveVoice.listen.ask")}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={state.phase === "failed" || state.phase === "ended" ? "close" : "stop"}
        aria-label={t("liveVoice.listen.stop")}
        onClick={() => {
          void session.call.stop();
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}

// ── Starting a call ───────────────────────────────────────────────────────────

/**
 * The header's call button: "Entrar" while the conversation's room is live, else a phone that starts one (with the
 * agents picked; in an agent's DM, that agent).
 */
export function CallButton({
  channelId,
  title,
  agents,
  dmAgent,
}: {
  channelId: string;
  /** The conversation's name as its header shows it ("#geral", or the person or agent of a DM). */
  title: string;
  agents: Agent[];
  dmAgent?: Agent;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const live = useLiveVoiceActions();
  const room = useChannelLiveRoom(org.id, channelId, Boolean(live));
  const [picking, setPicking] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  if (!live) return null;
  const inThisCall = live.roomChannel === channelId && live.room?.getState().phase === "live";
  const current = room.data;
  if (current && !inThisCall) {
    return (
      <Button size="sm" variant="primary" className="lv-join" onClick={() => live.startRoom(channelId, [], title)}>
        <HandsetIcon />
        {t("liveVoice.call.join", { count: current.people.length })}
      </Button>
    );
  }
  const start = () => {
    // An agent's DM calls that agent, as the Nordus call did; without the workspace's key, where it goes.
    if (dmAgent && !live.available) setNeedsKey(true);
    else if (dmAgent) live.callAgent(dmAgent.id, channelId);
    else if (agents.length) setPicking(true);
    else live.startRoom(channelId, [], title);
  };
  return (
    <>
      <button
        type="button"
        className="ac-btn ac-btn--ghost ac-btn--icon channel__icon"
        aria-label={dmAgent ? t("liveVoice.call.callAgent", { name: dmAgent.name }) : t("liveVoice.call.start")}
        title={dmAgent ? t("liveVoice.call.callAgent", { name: dmAgent.name }) : t("liveVoice.call.start")}
        disabled={inThisCall || Boolean(dmAgent && live.agentCall && live.agentCall.getState().phase !== "ended")}
        onClick={start}
      >
        <HandsetIcon />
      </button>
      {needsKey && <NeedsKeyDialog name={dmAgent?.name ?? ""} onClose={() => setNeedsKey(false)} />}
      {picking && (
        <StartCallDialog
          agents={agents}
          available={live.available}
          onClose={() => setPicking(false)}
          onStart={(ids, options) => {
            setPicking(false);
            live.startRoom(channelId, ids, title, options);
          }}
        />
      )}
    </>
  );
}

interface Ring {
  roomId: string;
  channelId: string;
  channelName: string | null;
  byName: string;
  byUserId: string;
}

/** Rings for this long, then goes (the mention stays in the conversation and the inbox). */
const RING_MS = 45_000;

function IncomingCall({
  ring,
  inCall,
  onJoin,
  onClose,
}: {
  ring: Ring;
  /** Already in that call: nothing to answer. */
  inCall: boolean;
  onJoin: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const navigate = useNavigate();
  const by = dir.memberById.get(ring.byUserId);
  useEffect(() => {
    if (inCall) return onClose();
    playSound("attention");
    const again = setInterval(() => playSound("attention"), 4000);
    const stop = setTimeout(onClose, RING_MS);
    return () => {
      clearInterval(again);
      clearTimeout(stop);
    };
  }, [inCall, onClose]);
  if (inCall) return null;
  const name = by?.name ?? ring.byName;
  return createPortal(
    <section className="lv-ring" role="alertdialog" aria-label={t("liveVoice.ring.title", { name })}>
      <Avatar name={name} imageUrl={by?.image ?? undefined} size="md" />
      <span className="lv-ring__text">
        <b>{t("liveVoice.ring.title", { name })}</b>
        <span>{t("liveVoice.ring.where", { channel: ring.channelName ? `#${ring.channelName}` : "" })}</span>
      </span>
      <Button size="sm" onClick={onClose}>
        {t("liveVoice.ring.decline")}
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          void navigate({ to: "/org/$orgId/c/$channelId", params: { orgId: org.id, channelId: ring.channelId } });
          onJoin();
        }}
      >
        <HandsetIcon />
        {t("liveVoice.ring.join")}
      </Button>
    </section>,
    document.body,
  );
}

/** The workspace's people to call, but those left out (oneself, who's already on the call). */
function PeoplePicker({
  except,
  picked,
  onChange,
}: {
  except: string[];
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const people = dir.members.filter((m) => !except.includes(m.userId));
  if (!people.length) return <p className="lv-pick__none">{t("liveVoice.invite.none")}</p>;
  return (
    <div className="lv-pick">
      {people.map((person) => {
        const on = picked.includes(person.userId);
        return (
          <div key={person.userId} className="lv-pick__row">
            <Checkbox
              id={`lv-person-${person.userId}`}
              checked={on}
              disabled={!on && picked.length >= 10}
              onCheckedChange={(next) =>
                onChange(next ? [...picked, person.userId] : picked.filter((id) => id !== person.userId))
              }
            />
            <label htmlFor={`lv-person-${person.userId}`} className="lv-pick__label">
              <Avatar name={person.name ?? ""} imageUrl={person.image ?? undefined} size="sm" />
              <span className="lv-pick__name">{person.name}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

function InviteDialog({ call, onClose }: { call: RoomCall; onClose: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const state = useCall(call);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const here = [me.user.id, ...(state.room?.people.map((p) => p.userId) ?? [])];
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const out = await call.invite(picked);
      if (out.refused.length) {
        setRefused(out.refused);
        setPicked([]);
      } else onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("liveVoice.invite.title")}
      description={t("liveVoice.invite.lead")}
      closeLabel={t("common.close")}
      width={400}
    >
      <DialogBody>
        <PeoplePicker except={here} picked={picked} onChange={setPicked} />
        {refused.length > 0 && (
          <p className="lv-pick__none" role="alert">
            {t("liveVoice.invite.refused", {
              names: refused.map((id) => dir.memberById.get(id)?.name ?? "").join(", "),
            })}
          </p>
        )}
        {error ? (
          <p className="lv-pick__none" role="alert">
            {errorText(t, error)}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!picked.length || sending} onClick={() => void send()}>
          {t("liveVoice.invite.send")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function StartCallDialog({
  agents,
  available,
  onClose,
  onStart,
}: {
  agents: Agent[];
  available: boolean;
  onClose: () => void;
  onStart: (agentIds: string[], options: { topic: string | null; invite: string[] }) => void;
}) {
  const { t } = useTranslation();
  const { me } = useOrg();
  const [people, setPeople] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const canPick = available;
  const [picked, setPicked] = useState<string[]>(() => (available ? agents.slice(0, 3).map((a) => a.id) : []));
  const max = 5;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("liveVoice.call.title")}
      description={t("liveVoice.call.lead")}
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogBody>
        <div className="lv-pick">
          {agents.map((agent) => {
            const on = picked.includes(agent.id);
            return (
              <div key={agent.id} className="lv-pick__row">
                <Checkbox
                  id={`lv-pick-${agent.id}`}
                  checked={on}
                  disabled={!canPick || (!on && picked.length >= max)}
                  onCheckedChange={(next) =>
                    setPicked((p) => (next ? [...p, agent.id] : p.filter((id) => id !== agent.id)))
                  }
                />
                <label htmlFor={`lv-pick-${agent.id}`} className="lv-pick__label">
                  <AgentAvatar agentId={agent.id} name={agent.name} size="sm" />
                  <span className="lv-pick__name">{agent.name}</span>
                  {agent.role && <span className="lv-pick__role">{agent.role}</span>}
                </label>
              </div>
            );
          })}
        </div>
        {canPick && picked.length > 0 && (
          <div className="lv-topic">
            <label className="lv-topic__label" htmlFor="lv-topic">
              {t("liveVoice.call.topic")}
            </label>
            <Textarea
              id="lv-topic"
              value={topic}
              rows={2}
              maxLength={500}
              placeholder={t("liveVoice.call.topicHint")}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
        )}
        {!canPick && <KeyWhere />}
        <div className="lv-topic">
          <span className="lv-topic__label">{t("liveVoice.call.people")}</span>
          <PeoplePicker except={[me.user.id]} picked={people} onChange={setPeople} />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          onClick={() => onStart(canPick ? picked : [], { topic: topic.trim() || null, invite: people })}
        >
          {picked.length ? t("liveVoice.call.startWith", { count: picked.length }) : t("liveVoice.call.peopleOnly")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── A call with one agent ─────────────────────────────────────────────────────

/**
 * The call bar of a call with one agent (as the Nordus call bar): small, at the top, so the conversation stays in sight
 * and shows the agent's work while the person talks. The agent's face lights with its voice; the latest words show
 * under its name.
 */
function AgentCallBar({ call, agentId, onClose }: { call: AgentCall; agentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const state = useSyncExternalStore(call.subscribe, call.getState);
  const ref = useGlow(call, "agent:call");
  const now = useNow();
  const agent = dir.agentById.get(agentId);
  const name = agent?.name ?? "";
  useEffect(() => {
    if (state.phase !== "ended") return;
    const timer = setTimeout(onClose, 1200);
    return () => clearTimeout(timer);
  }, [state.phase, onClose]);
  const line =
    state.phase === "failed"
      ? errorText(t, state.error)
      : state.phase === "connecting"
        ? t("liveVoice.agentCall.connecting", { name })
        : state.phase === "ended"
          ? t("liveVoice.room.ended")
          : state.caption
            ? state.caption.text
            : state.micOn
              ? t("liveVoice.agentCall.listening")
              : t("liveVoice.room.muted");
  const done = state.phase === "failed" || state.phase === "ended";
  return createPortal(
    <section className="lv-callbar" aria-label={t("liveVoice.agentCall.title", { name })}>
      <div ref={ref} className="lv-callbar__face">
        <AgentAvatar agentId={agentId} name={name} size="sm" />
      </div>
      <div className="lv-callbar__text">
        <span className="lv-callbar__name">
          {name}
          {state.phase === "live" && (
            <span className="lv-callbar__time">{elapsed(new Date(state.startedAt).toISOString(), now)}</span>
          )}
        </span>
        <span
          className="lv-callbar__line"
          data-who={state.caption?.who}
          aria-live={state.phase === "failed" ? "assertive" : "off"}
        >
          {line}
        </span>
      </div>
      {!done && (
        <button
          type="button"
          className="lv-round lv-round--sm"
          data-off={!state.micOn || undefined}
          aria-pressed={!state.micOn}
          aria-label={state.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
          title={state.micOn ? t("liveVoice.room.micOff") : t("liveVoice.room.micOn")}
          onClick={() => call.toggleMic()}
        >
          {state.micOn ? <Icon name="mic" /> : <MicOffIcon />}
        </button>
      )}
      <button
        type="button"
        className={done ? "lv-round lv-round--sm" : "lv-round lv-round--sm lv-round--leave"}
        aria-label={done ? t("common.close") : t("liveVoice.agentCall.hangUp")}
        title={done ? t("common.close") : t("liveVoice.agentCall.hangUp")}
        onClick={() => {
          void call.stop();
          onClose();
        }}
      >
        {done ? <Icon name="close" /> : <HandsetIcon hangUp />}
      </button>
    </section>,
    document.body,
  );
}

/** Where the workspace's GPT-Live key goes, with the way there for who may put it. */
function KeyWhere() {
  const { t } = useTranslation();
  const { org } = useOrg();
  return (
    <p className="lv-keywhere">
      {t("liveVoice.call.keyWhere")}{" "}
      {can(org, "configure") ? (
        <Link className="ac-link" to="/org/$orgId/settings/$section" params={{ orgId: org.id, section: "voice" }}>
          {t("liveVoice.call.keyOpen")}
        </Link>
      ) : (
        t("liveVoice.call.keyAsk")
      )}
    </p>
  );
}

export function NeedsKeyDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("liveVoice.call.needsKeyTitle", { name })}
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogBody>
        <KeyWhere />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogFooter>
    </Dialog>
  );
}
