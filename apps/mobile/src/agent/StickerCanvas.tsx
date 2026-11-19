import type { StickerLook, StickerMood } from "@dougbot/ui/agent/stickers";
import { createContext, memo, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { botDoAgente, svgDoBot } from "@/brand/bots";
import type { DougBotEstado, DougBotOlhar } from "@/brand/dougbot-avatar.js";
import { useReducedMotion, useTheme } from "@/ui/theme";
import { frameClock } from "./clock";
import { useLivePaused } from "./live";
import type { AgentLookInput } from "./looks";
import type { StickerStage } from "./sticker-stage";

/** The stage of the list the stickers are in (none: they stand still). */
export const StickerStageContext = createContext<StickerStage | null>(null);

const noStage = () => () => undefined;

/** Whether the sticker that goes by `id` on its list's stage may play now. */
export function useStickerLive(id: string | undefined): boolean {
  const stage = useContext(StickerStageContext);
  return useSyncExternalStore(stage?.subscribe ?? noStage, () => Boolean(stage && id && stage.isLive(id)));
}

/** A sticker's look: the stored look plus, when the caller knows it, who the agent is (its DougBot). */
export type StickerWho = StickerLook & Partial<Pick<AgentLookInput, "name" | "handle" | "role" | "id" | "shape">>;

/**
 * Each mood as the DougBot says it: the state its eyes take (the Doug's own look where he has one) and how the piece
 * moves. One loop is `ms` long and starts and ends at rest, so a sticker that stops never jumps.
 */
const MOODS: Record<StickerMood, { estado: DougBotEstado; olhar: DougBotOlhar; ms: number }> = {
  wave: { estado: "ok", olhar: "feliz", ms: 800 },
  celebrate: { estado: "terminou", olhar: "rindo", ms: 700 },
  love: { estado: "terminou", olhar: "feliz", ms: 900 },
  deal: { estado: "ok", olhar: "piscando", ms: 1000 },
  thinking: { estado: "pedindo", olhar: "pra-cima", ms: 2200 },
  wow: { estado: "pedindo", olhar: "surpreso", ms: 900 },
  dizzy: { estado: "ok", olhar: "de-lado", ms: 1400 },
};

/** The Doug when no agent is named (an empty place with nobody of its own). */
const DEFAULT_WHO = { name: "doug" } as const;

function StickerCanvasView({
  look,
  mood,
  size,
  seed,
  live,
  playFor,
  from,
}: {
  look: StickerWho;
  mood: StickerMood;
  size: number;
  /** Keeps stickers side by side out of step: the agent's id. */
  seed: string;
  live: boolean;
  /** Plays once, for this many seconds from when it shows, then stands still; without it, it loops. */
  playFor?: number;
  /** When that one play started on the frame clock, if before it showed here (it then goes on, not again). */
  from?: number;
}) {
  const reduced = useReducedMotion();
  const paused = useLivePaused();
  const { scheme } = useTheme();
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [shownAt] = useState(() => frameClock.time());
  const start = from ?? shownAt;
  const m = MOODS[mood] ?? MOODS.wave;

  const named = look.name || look.handle || look.shape;
  const bot = useMemo(
    () =>
      botDoAgente(
        named
          ? {
              name: look.name ?? null,
              handle: look.handle ?? null,
              role: look.role ?? null,
              id: look.id ?? seed,
              look: look.shape
                ? { shape: look.shape, color: look.color, eyes: look.eyes, accessory: look.accessory }
                : null,
            }
          : DEFAULT_WHO,
      ),
    [named, look.name, look.handle, look.role, look.id, look.shape, look.color, look.eyes, look.accessory, seed],
  );
  const xml = useMemo(
    () =>
      svgDoBot({
        ...bot,
        estado: m.estado,
        ...(bot.bot === "doug" ? { olhar: m.olhar } : {}),
        tamanho: size,
        brilho: scheme === "dark" && size >= 44,
        id,
      }),
    [bot, m.estado, m.olhar, size, scheme, id],
  );

  // How many loops are left of a play-once (none once it is over); `undefined` loops for as long as it is live.
  const loops = useMemo(() => {
    if (playFor === undefined) return undefined;
    const left = start + playFor - frameClock.time();
    return left <= 0 ? 0 : Math.max(1, Math.round((left * 1000) / m.ms));
  }, [playFor, start, m.ms]);
  const moving = live && !reduced && !paused && loops !== 0;

  const p = useSharedValue(0);
  useEffect(() => {
    if (!moving) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    // Out of step with its neighbors: the seed picks where in the loop it starts (a play-once starts at rest).
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    p.value = loops === undefined ? (h % 100) / 100 : 0;
    p.value = withRepeat(withTiming(1, { duration: m.ms, easing: Easing.linear }), loops ?? -1, false);
    return () => cancelAnimation(p);
  }, [moving, loops, m.ms, seed, p]);

  const motion = useAnimatedStyle(() => {
    const a = Math.sin(p.value * 2 * Math.PI);
    const up = Math.abs(Math.sin(p.value * Math.PI));
    switch (mood) {
      case "wave":
        return { transform: [{ rotate: `${a * 9}deg` }] };
      case "celebrate":
        return { transform: [{ translateY: -up * size * 0.08 }, { scale: 1 + up * 0.04 }] };
      case "love":
        return { transform: [{ scale: 1 + up * 0.07 }] };
      case "deal":
        return { transform: [{ translateY: up * size * 0.03 }, { rotate: `${a * 3}deg` }] };
      case "thinking":
        return { transform: [{ rotate: `${a * 5}deg` }, { translateX: a * size * 0.02 }] };
      case "wow":
        return { transform: [{ scale: 1 + up * 0.1 }] };
      default:
        return { transform: [{ rotate: `${a * 12}deg` }, { translateX: a * size * 0.03 }] };
    }
  });

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[{ width: size, height: size, transformOrigin: "50% 90%" }, motion]}>
        <SvgXml xml={xml} width={size} height={size} />
      </Animated.View>
    </View>
  );
}

/**
 * An agent's sticker: its DougBot (the identity's bot for the agent, the Doug when nobody is named) saying the mood
 * with its eyes and a small motion of the whole piece, on the UI thread. No pixel art. While `live` it loops, out of
 * step with its neighbors by its seed; with reduced motion, on a screen that isn't showing or with the app in the
 * background it stands still. A sticker that plays once (`playFor`) ends at rest, so stopping shows no jump.
 */
export const StickerCanvas = memo(
  StickerCanvasView,
  (a, b) =>
    a.mood === b.mood &&
    a.size === b.size &&
    a.seed === b.seed &&
    a.live === b.live &&
    a.playFor === b.playFor &&
    a.from === b.from &&
    a.look.color === b.look.color &&
    a.look.eyes === b.look.eyes &&
    a.look.accessory === b.look.accessory &&
    a.look.name === b.look.name &&
    a.look.handle === b.look.handle &&
    a.look.shape === b.look.shape,
);
