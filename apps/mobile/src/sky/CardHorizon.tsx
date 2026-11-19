import type { AgentColorName } from "@dougbot/ui/agent/engine";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * Where the agents' dithered horizon rose at the foot of a card with room to spare. DougBot has no decorative
 * horizon: it draws nothing (it was absolute, so nothing moves). The props stay for the callers.
 */
export function CardHorizon(_props: {
  width: number;
  room: number;
  /** The card's ground, as "#rrggbb". */
  surface: string;
  color?: AgentColorName;
  x?: number;
  minRoom?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return null;
}
