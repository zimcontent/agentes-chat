import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { Text as RNText, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from "react-native-svg";
import { DB_FONTES } from "@/brand/tokens";
import { useTheme } from "@/ui/theme";
import { initialsOf, toneOf } from "./rules";

/*
 * The WhatsApp screens' own look (docs/adr/doug-0001-whatsapp-numbers.md): a number's conversations read as the
 * phone's WhatsApp does, in its dark and its light, so the owner feels at home there. The rest of the app keeps
 * DougBot's identity: these colors live only here.
 */

export interface WaColors {
  /** The list's ground and the screen's under the wall. */
  bg: string;
  /** The conversation's bar and the strip above its field. */
  bar: string;
  line: string;
  ink: string;
  /** Secondary words (times, last lines): 4.5:1 on `bg` and on a received bubble. */
  sub: string;
  /** Icons and quieter words a step up from `sub`. */
  soft: string;
  green: string;
  /** Words on `green`. */
  onGreen: string;
  /** The search, the filters and the message field. */
  field: string;
  chosen: string;
  chosenInk: string;
  wall: string;
  doodle: string;
  doodleOpacity: number;
  bubbleIn: string;
  bubbleOut: string;
  /** Time and ticks inside a sent bubble. */
  metaOut: string;
  /** "Sent by …" inside a sent bubble. */
  byOut: string;
  read: string;
  dayFill: string;
  dayInk: string;
  stripEdge: string;
  /** The strip's button: light on dark, as the app's own secondary pill. */
  stripButton: string;
  stripButtonInk: string;
  /** A voice message's played bars. */
  played: string;
  danger: string;
}

const DARK: WaColors = {
  bg: "#0B141A",
  bar: "#111B21",
  line: "#1F2C34",
  ink: "#E9EDEF",
  sub: "#8696A0",
  soft: "#AEBAC1",
  green: "#21C063",
  onGreen: "#0B141A",
  field: "#1F272A",
  chosen: "#103529",
  chosenInk: "#D9FDD3",
  wall: "#0B141A",
  doodle: "#FFFFFF",
  doodleOpacity: 0.045,
  bubbleIn: "#202C33",
  bubbleOut: "#005C4B",
  metaOut: "#9FC8BF",
  byOut: "#C3E3DA",
  read: "#53BDEB",
  dayFill: "#182229",
  dayInk: "#8696A0",
  stripEdge: "#233138",
  stripButton: "#EDEDED",
  stripButtonInk: "#0A0A0A",
  played: "#53BDEB",
  danger: "#F15C6D",
};

const LIGHT: WaColors = {
  bg: "#FFFFFF",
  bar: "#FFFFFF",
  line: "#E9EDEF",
  ink: "#111B21",
  sub: "#667781",
  soft: "#54656F",
  green: "#1DAA61",
  onGreen: "#FFFFFF",
  field: "#F0F2F5",
  chosen: "#D9FDD3",
  chosenInk: "#0A3D2A",
  wall: "#EFEAE2",
  doodle: "#4A3B2A",
  doodleOpacity: 0.07,
  bubbleIn: "#FFFFFF",
  bubbleOut: "#D9FDD3",
  metaOut: "#55705F",
  byOut: "#3E5C4C",
  read: "#027EB5",
  dayFill: "#FFFFFF",
  dayInk: "#54656F",
  stripEdge: "#E9EDEF",
  stripButton: "#111B21",
  stripButtonInk: "#FFFFFF",
  played: "#027EB5",
  danger: "#D42A3F",
};

/** The WhatsApp colors for the app's scheme. */
export function useWa(): WaColors {
  return useTheme().scheme === "dark" ? DARK : LIGHT;
}

/** The fonts the screens use, by weight. */
export const WA_FONT = {
  r: DB_FONTES.texto400,
  m: DB_FONTES.texto500,
  s: DB_FONTES.texto600,
  b: DB_FONTES.texto700,
} as const;

/** A photo with no picture: the initials on one of these tones, fading to the dark, as a contact without a photo. */
const TONES = ["#7C5CFF", "#E5734B", "#2BA5A5", "#D9468F", "#4F7DF0", "#8C9A3A", "#C58B2C", "#3E9B5F"];

/** A contact's photo: the picture WhatsApp has, or the initials on a tone that is always theirs. */
export const WaPhoto = memo(function WaPhoto({
  id,
  title,
  size,
  photo,
}: {
  id: string;
  title: string;
  size: number;
  photo: { uri: string; headers?: Record<string, string> } | null;
}) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (photo) return <Image source={photo} style={round} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <LinearGradient
      colors={[toneOf(id, TONES), "#1A2329"]}
      start={{ x: 0.25, y: 0 }}
      end={{ x: 0.85, y: 1.1 }}
      style={[round, styles.center]}
    >
      <RNText
        allowFontScaling={false}
        style={{ fontFamily: WA_FONT.s, fontSize: Math.round(size * 0.33), color: "#FFFFFF" }}
      >
        {initialsOf(title)}
      </RNText>
    </LinearGradient>
  );
});

/**
 * The conversation's wall: small line doodles of our own (rings, a chevron, a plus, a box, an arc, a tent, a dash, a
 * triangle) repeated every 120 points, barely there, as WhatsApp's own wall but not its drawing.
 */
export const WaWall = memo(function WaWall() {
  const wa = useWa();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: wa.wall }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="wa-doodles" width={120} height={120} patternUnits="userSpaceOnUse">
            {/* A pattern's drawing inherits nothing from what it fills: its stroke is set here. */}
            <G
              fill="none"
              stroke={wa.doodle}
              strokeOpacity={wa.doodleOpacity}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Circle cx={18} cy={20} r={7} />
              <Path d="M50 12l8 8-8 8M84 18h16M92 10v16" />
              <Rect x={12} y={60} width={16} height={12} rx={3} />
              <Path d="M52 64c4-6 12-6 16 0M60 56v4" />
              <Circle cx={96} cy={66} r={4} />
              <Path d="M14 100l10-8 10 8M56 98h18M98 92l6 10h-12z" />
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#wa-doodles)" />
      </Svg>
    </View>
  );
});

/** The line glyphs WhatsApp's bar and field use that the app's own set doesn't have (24-point grid). */
const GLYPHS = {
  clip: "m19 11.5-7.4 7.4a4.5 4.5 0 0 1-6.4-6.4l7.8-7.8a3 3 0 0 1 4.2 4.2l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7",
  camera:
    "M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
  smile: "M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  mic: "M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3M6 11.5a6 6 0 0 0 12 0M12 17.5V20",
  phone:
    "M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z",
  plus: "M12 5v14M5 12h14",
  sliders:
    "M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20M17.5 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M11.5 16.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
  search: "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0m2.5 9-4.2-4.2",
  down: "m7 10 5 5 5-5",
  play: "M7 5.5v13l11-6.5z",
  playBox:
    "M7 5h10a3.5 3.5 0 0 1 3.5 3.5v7A3.5 3.5 0 0 1 17 19H7a3.5 3.5 0 0 1-3.5-3.5v-7A3.5 3.5 0 0 1 7 5m3.5 4.5v5l4-2.5z",
  pause: "M8 5.5v13M16 5.5v13",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  send: "M4 12 20 4l-4 16-4-7z",
  file: "M7 3.5h6l4.5 4.5v11.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1M13 3.5V8h4.5",
} as const;

export type WaGlyphName = keyof typeof GLYPHS;

/** One of the glyphs above, stroked in `color`. */
export function WaGlyph({
  name,
  size = 22,
  color,
  weight = 1.6,
  fill,
}: {
  name: WaGlyphName;
  size?: number;
  color: string;
  weight?: number;
  fill?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={GLYPHS[name]}
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={fill ?? "none"}
      />
    </Svg>
  );
}

/** WhatsApp's ticks: one gray (sent), two gray (delivered), two blue (read). */
export function WaTicks({ status, color, read }: { status: string; color: string; read: string }) {
  if (status === "received") return null;
  const two = status !== "sent";
  return (
    <Svg width={17} height={11} viewBox="0 0 18 12">
      <Path
        d={two ? "M1 6.5 4.5 10 11 2.5M7.5 9.5l.6.6L15 2.5" : "M3 6.5 6.5 10 13 2.5"}
        fill="none"
        stroke={status === "read" ? read : color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** WhatsApp's own mark (the number picker), in its green: a third party's product shows its logo (rule 22). */
export function WhatsAppMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
