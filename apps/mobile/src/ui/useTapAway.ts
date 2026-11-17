import { useMemo, useRef } from "react";
import { type GestureResponderEvent, Keyboard } from "react-native";
import { isTap, type TouchAt } from "./tap-away";

/**
 * A tap anywhere in what these handlers go on closes the keyboard, as in any messenger: the conversation above the
 * field, however short (dragging it down only works where it scrolls). They only listen, so a link, a card's button or
 * a message's hold still does what it does; a drag or a hold leaves the keyboard up. Spread on a `View`.
 */
export function useTapAway() {
  const start = useRef<TouchAt | null>(null);
  return useMemo(() => {
    const at = (e: GestureResponderEvent): TouchAt => ({
      x: e.nativeEvent.pageX,
      y: e.nativeEvent.pageY,
      at: e.nativeEvent.timestamp,
    });
    return {
      onTouchStart: (e: GestureResponderEvent) => {
        start.current = e.nativeEvent.touches.length > 1 ? null : at(e);
      },
      onTouchEnd: (e: GestureResponderEvent) => {
        const from = start.current;
        start.current = null;
        // A second finger that lands and lifts still has one on the screen: not a tap.
        if (!from || e.nativeEvent.touches.length > 0 || !isTap(from, at(e))) return;
        if (Keyboard.isVisible()) Keyboard.dismiss();
      },
      // A list that starts scrolling takes the touch: no tap.
      onTouchCancel: () => {
        start.current = null;
      },
    };
  }, []);
}
