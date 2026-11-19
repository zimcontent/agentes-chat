import { bodyTones, drawAccessory, drawAgent, drawSleep, type Expression, EYE_COLOR } from "@dougbot/ui/agent/engine";
import { avatarSkyCell, avatarSkyCells, avatarSkyTones } from "@dougbot/ui/sky/avatar";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { botDoAgente, estadoDoModo, svgDoBot } from "@/brand/bots";
import { appHeaders, lastCookie } from "@/lib/auth";
import { photoSource } from "@/lib/photo";
import { serverUrl } from "@/lib/server";
import { useTheme } from "@/ui/theme";
import type { AgentLookInput } from "./looks";
import { type AgentMode, agentLayout, framedLayout, poseFor, STILL_T } from "./poses";
import { asCtx, compile, RecordingContext } from "./recorder";

const GAZE: Record<Gaze, { look: [number, number]; turn: [number, number] }> = {
  up: { look: [0, -0.14], turn: [0, -0.35] },
  down: { look: [0, 0.14], turn: [0, 0.35] },
};

export interface AgentAvatarProps {
  agent: AgentLookInput;
  /** Box size in points. */
  size: number;
  mode?: AgentMode;
  /** Kept for callers: DougBot's bots are still drawings (their eyes say the state by their shape). */
  live?: boolean;
  /** The agent's name, for screen readers. */
  name?: string;
  /** Kept for callers: the bots are glass pieces of their own, never in a tile. */
  framed?: boolean;
  /** A face held for a moment (the sign-in screens, a hello): the identity's state that matches it. */
  expression?: Expression;
  /** Kept for callers (the old bodies looked up or down): DougBot's bots look up only to ask. */
  gaze?: Gaze;
  /** Away on a routine: the piece dims until it comes back. */
  bodyless?: boolean;
  /** The tile's corner (framed only). Default 30% of the side; `size / 2` inside a fully round pill. */
  radius?: number;
}

/** Up or down the screen. */
export type Gaze = "up" | "down";

/**
 * The real photo sits where the Doug's glass frame is (`QUADRO`: 10…110 of 120, corner 28), so a photo and a drawn bot
 * line up in a list and the presence badge keeps its corner.
 */
export const PHOTO_INSET = 10 / 120;
export const PHOTO_RADIUS = 28 / 120;

/** One frame of an agent as drawing commands (the engine draws, the recorder keeps the commands). */
export function agentFrame(
  agent: AgentLookInput,
  size: number,
  mode: AgentMode,
  t: number,
  seed: number,
  reduced: boolean,
  frame?: { dark: boolean },
  expression?: Expression,
  dark = frame?.dark ?? false,
  extra?: { gaze?: Gaze | undefined; bodyless?: boolean | undefined },
) {
  const accessory = agent.accessory && agent.accessory !== "none" ? agent.accessory : undefined;
  const box = frame ? framedLayout(size, Boolean(accessory)) : agentLayout(size, Boolean(accessory));
  const rec = new RecordingContext();
  if (frame) {
    // The tile's sky (`@dougbot/ui/sky/avatar`): a Bayer dither from the top tone to the bottom one.
    const [top, bottom] = avatarSkyTones(agent.color, frame.dark);
    const n = avatarSkyCells(size * 2);
    const cell = size / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        rec.fillStyle = avatarSkyCell(x, y, n) ? bottom : top;
        rec.fillRect(x * cell, y * cell, cell, cell);
      }
  }
  // Away on a routine: the frame keeps its sky and waits for it.
  if (frame && extra?.bodyless) return compile(rec.commands);
  const base = poseFor(mode, t, seed, reduced);
  const looked = extra?.gaze ? { ...base, ...GAZE[extra.gaze] } : base;
  drawAgent(asCtx(rec), box.x, box.y, box.inner, {
    color: agent.color,
    eyes: agent.eyes,
    cells: box.cells,
    pose: expression ? { ...looked, expression, blink: false } : looked,
    after: (ctx, side, body) => {
      if (box.withAccessory && accessory) drawAccessory(ctx, side, accessory, body, t, mode === "run");
      // A sleeping agent's zz: the body's darkest tone on a light page, white on a dark one.
      if (mode === "sleep")
        drawSleep(
          ctx,
          side,
          body,
          dark ? EYE_COLOR : (bodyTones(agent.color)[0] ?? EYE_COLOR),
          // A still frame shows both z's.
          reduced || t === STILL_T ? undefined : t,
        );
    },
  });
  return compile(rec.commands);
}

/**
 * An agent: its real photo when the person gave it one (`agent.photo`, ADR-less fork feature: the same contract as the
 * web), else its DougBot drawn by code (`dougbot-avatar.js`, IDENTIDADE.md §8) as SVG, never an image file. The form
 * says the trade, the Doug is a bot's head in a piece of green glass, and the mode/presence picks one of the five
 * states (ok, trabalhando, pedindo, terminou, dormindo). Below 60 the Doug's head fills his piece; from 44 up, and
 * only on the dark stage, the bot lights the floor under it (§7 "Tamanhos"). A photo that fails falls back to the
 * drawing.
 */
function AgentAvatarView({ agent, size, mode = "idle", name, expression, bodyless = false, radius }: AgentAvatarProps) {
  const { scheme } = useTheme();
  const { t: tr } = useTranslation();
  const dark = scheme === "dark";
  // Ids inside the SVG are per drawing: two bots on a web page never share a gradient (native scopes them anyway).
  const id = `b${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const bot = useMemo(
    () =>
      botDoAgente({
        name: agent.name ?? name,
        handle: agent.handle,
        role: agent.role,
        id: agent.id ?? agent.color,
        look: agent.shape
          ? { shape: agent.shape, color: agent.color, eyes: agent.eyes, accessory: agent.accessory }
          : null,
      }),
    [agent.name, name, agent.handle, agent.role, agent.id, agent.color, agent.shape, agent.eyes, agent.accessory],
  );
  const estado = bodyless ? "dormindo" : estadoDoModo(mode, expression);
  const xml = useMemo(
    () => svgDoBot({ ...bot, estado, tamanho: size, brilho: dark && size >= 44, id }),
    [bot, estado, size, dark, id],
  );
  const photo = useMemo(() => photoSource(agent.photo ?? null, serverUrl(), appHeaders(lastCookie())), [agent.photo]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (photo?.uri) setFailed(false);
  }, [photo?.uri]);
  const label = name
    ? tr(estado === "trabalhando" ? "mobile.a11y.agentWorking" : "mobile.a11y.agent", { name })
    : tr("mobile.a11y.agentPlain");
  const inset = Math.round(size * PHOTO_INSET);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }}>
      {photo && !failed ? (
        <Image
          source={photo}
          onError={() => setFailed(true)}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          style={[
            styles.photo,
            {
              top: inset,
              left: inset,
              width: size - inset * 2,
              height: size - inset * 2,
              borderRadius: radius ?? size * PHOTO_RADIUS,
              opacity: bodyless ? 0.4 : 1,
            },
          ]}
        />
      ) : (
        <SvgXml xml={xml} width={size} height={size} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ photo: { position: "absolute" } });

/** An agent's face: its photo or its DougBot (see `AgentAvatarView`). */
export const AgentAvatar = memo(
  AgentAvatarView,
  (a, b) =>
    a.size === b.size &&
    a.mode === b.mode &&
    a.name === b.name &&
    a.expression === b.expression &&
    a.bodyless === b.bodyless &&
    a.radius === b.radius &&
    a.agent.color === b.agent.color &&
    a.agent.id === b.agent.id &&
    a.agent.name === b.agent.name &&
    a.agent.handle === b.agent.handle &&
    a.agent.role === b.agent.role &&
    a.agent.photo === b.agent.photo,
);
