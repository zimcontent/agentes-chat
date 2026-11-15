import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addLiveSticker, drawLiveSticker, type LiveSticker, stickerNow } from "../agent/sticker-live";
import { type StickerMood, stickerSeed } from "../agent/stickers";
import { PIXEL_ART } from "../brand/doug";
import type { DougBotEstado } from "../brand/dougbot-avatar.js";
import { type AgenteParaBot, botDoAgente } from "../brand/dougbot-time";
import { cx } from "../cx";
import type { AgentAppearance } from "./AgentLook";
import { BotFace } from "./BotFace";

export interface AgentStickerProps {
  /** The agent's look (color, eyes, accessory); none draws the default agent. */
  appearance?: AgentAppearance;
  mood: StickerMood;
  /** Plays once, for this many seconds from when it shows, then holds its last frame; without it, it loops. */
  playFor?: number;
  /** The side in CSS pixels: about 88 in the picker, 120 in a message. */
  size?: number;
  /** Keeps stickers side by side out of step: the agent's id. */
  seed?: string;
  /** The accessible name ("Figurinha do Dev: comemorando"); without it the sticker is decorative. */
  label?: string;
  className?: string;
  /** Who the agent is, for its DougBot (`brand/dougbot-time.ts`); left out, the Doug. */
  who?: AgenteParaBot;
}

/** The Doug, for a sticker with no agent of its own (an empty place, the onboarding's guide). */
const DOUG: AgenteParaBot = { name: "Doug", builtin: "right_hand" };

/**
 * A mood as the bot's face says it (IDENTIDADE.md §7): it has no arms, so a mood is its eyes plus a small motion of
 * its own (`.ac-sticker--bot[data-mood]` in doug.css).
 */
const MOOD_ESTADO: Record<StickerMood, DougBotEstado> = {
  celebrate: "terminou",
  love: "terminou",
  deal: "ok",
  thinking: "trabalhando",
  wow: "pedindo",
  dizzy: "trabalhando",
  wave: "ok",
};

/**
 * One of an agent's stickers (ADR 0091). In Doug (`PIXEL_ART` off) it is the agent's DougBot, drawn by the
 * identity's code, in its mood's face and motion; with the pixel art on, the pixel agent from the agent engine.
 */
export function AgentSticker(props: AgentStickerProps) {
  return PIXEL_ART ? <PixelSticker {...props} /> : <BotSticker {...props} />;
}

function BotSticker({ appearance, mood, playFor, size = 120, label, className, who }: AgentStickerProps) {
  const picked = appearance?.shape ? appearance : null;
  const key = `${who?.name ?? ""}|${who?.handle ?? ""}|${who?.role ?? ""}|${who?.builtin ?? ""}|${
    picked ? `${picked.shape}/${picked.color ?? ""}/${picked.eyes ?? ""}/${picked.accessory ?? ""}` : ""
  }`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is who it is and how it looks
  const bot = useMemo(() => botDoAgente({ ...(who ?? DOUG), look: picked }), [key]);
  return (
    <span
      className={cx("ac-sticker", "ac-sticker--bot", className)}
      style={{ width: size, height: size }}
      data-mood={mood}
      data-once={playFor !== undefined ? "" : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <BotFace bot={bot} estado={MOOD_ESTADO[mood]} guess={size} />
    </span>
  );
}

/**
 * One of an agent's stickers (ADR 0091): the agent itself, drawn by the agent engine from its look, in a mood that
 * loops while on screen (one shared loop for every sticker, none while out of view) and stands still with reduced
 * motion. No frame and no background: it stands on the page, bigger than an emoji.
 */
function PixelSticker({ appearance, mood, playFor, size = 120, seed, label, className }: AgentStickerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shownAt] = useState(stickerNow);
  const spec = useRef<ReturnType<LiveSticker["spec"]>>({ look: {}, mood, size, seed: 0 });
  spec.current = {
    look: { color: appearance?.color, eyes: appearance?.eyes, accessory: appearance?.accessory },
    mood,
    size,
    seed: playFor === undefined ? stickerSeed(seed ?? "") : -shownAt,
    end: playFor,
  };
  const live = useRef<LiveSticker | null>(null);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    live.current = { canvas: el, spec: () => spec.current };
    const stop = addLiveSticker(live.current);
    return () => {
      live.current = null;
      stop();
    };
  }, []);
  // The loop stands still with reduced motion: a new look or mood is drawn at once.
  const { color, eyes, accessory } = spec.current.look;
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw when what is drawn changes
  useLayoutEffect(() => {
    if (live.current) drawLiveSticker(live.current, stickerNow());
  }, [color, eyes, accessory, mood, size]);
  return (
    <canvas
      ref={canvas}
      className={cx("ac-sticker", className)}
      style={{ width: size, height: size }}
      data-mood={mood}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
