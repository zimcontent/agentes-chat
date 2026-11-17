import { memo } from "react";
import Svg, { Path } from "react-native-svg";
import { CURSOR_CELLS } from "./pixel-cursor";

/** Points per cell of the old grid: the arrow keeps the size (and the tip) the screen's math expects. */
export const CURSOR_SIZE = { width: CURSOR_CELLS.width * 2, height: CURSOR_CELLS.height * 2 };

/**
 * The person's pointer, drawn by the app over the agent's screen (ADR 0098): a clean arrow in the DougBot ink with a
 * white rim (no pixel art). Fixed colors, whatever the app's theme: it draws over the agent's desktop, never over the
 * app. Its tip is the box's top-left corner, where a click lands.
 */
export const PixelCursor = memo(function PixelCursor() {
  return (
    <Svg
      width={CURSOR_SIZE.width}
      height={CURSOR_SIZE.height}
      viewBox={`0 0 ${CURSOR_CELLS.width} ${CURSOR_CELLS.height}`}
    >
      <Path
        d="M0.6 0.6 L0.6 13.6 L3.7 10.8 L6.2 16.4 L8.4 15.4 L5.9 9.9 L10.2 9.9 Z"
        fill="#0A0A0A"
        stroke="#FFFFFF"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </Svg>
  );
});
