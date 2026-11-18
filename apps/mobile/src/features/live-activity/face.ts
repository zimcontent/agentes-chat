import { ImageFormat, Skia } from "@shopify/react-native-skia";
import { type AgenteParaBot, botDoAgente, corDoBot, svgDoBot } from "@/brand/bots";
import { liveColor } from "./logic";

/** The face's size in pixels: the lock screen draws it at 44 points, at 3x. */
const FACE_PX = 132;

/**
 * The agent's face and color for its Live Activity: the identity's bot drawn with Skia into a PNG (base64), which the
 * module leaves in the app group for the widget. Null when it can't be drawn: the widget then shows its initial.
 */
export function liveFace(agent: AgenteParaBot): { face: string | null; color: string } {
  const bot = botDoAgente(agent);
  const color = liveColor(corDoBot(bot));
  try {
    const svgText = svgDoBot({ ...bot, tamanho: FACE_PX }).replace(
      /\swidth="[\d.]+"\s+height="[\d.]+"/,
      ` width="${FACE_PX}" height="${FACE_PX}"`,
    );
    const svg = Skia.SVG.MakeFromString(svgText);
    const surface = Skia.Surface.Make(FACE_PX, FACE_PX);
    if (!svg || !surface) return { face: null, color };
    surface.getCanvas().drawSvg(svg, FACE_PX, FACE_PX);
    surface.flush();
    return { face: surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100) || null, color };
  } catch {
    return { face: null, color };
  }
}
