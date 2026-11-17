import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Sheet } from "@/ui";
import { createAfterGone } from "./after-gone";

/**
 * One bottom sheet per screen, opened from anywhere inside it (a card in a
 * list row, a header button): `open(content)` / `close()`. Keeps sheets out
 * of list cells, where they would be clipped or recycled.
 */
export interface SheetHost {
  /** `onClose`: called once when this sheet closes (by itself, the scrim, the grabber or `close`). */
  open: (content: ReactNode, options?: { solid?: boolean; onClose?: () => void }) => void;
  /**
   * `then`, when a function: once the sheet is gone from the screen (before presenting the photo library, the camera,
   * a picker). Anything else is ignored, so `close` can be a button's or the scrim's press handler as it is.
   */
  close: (then?: unknown) => void;
  /**
   * Hears the sheet open (before it does anything, the keyboard leaving included) and close: the screen under it
   * keeps still meanwhile (a conversation freezes its list). Returns the unsubscribe.
   */
  subscribe: (listener: (open: boolean) => void) => () => void;
}

const SheetContext = createContext<SheetHost | null>(null);

export function SheetHostProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const onClosed = useRef<(() => void) | null>(null);
  const listeners = useRef(new Set<(open: boolean) => void>());
  // What waits for the sheet to be gone; dropped with the screen.
  const [afterGone] = useState(createAfterGone);
  useEffect(() => () => afterGone.drop(), [afterGone]);
  const gone = afterGone.gone;
  // `then` only when a function: the scrim's press passes its event here.
  const close = useCallback(
    (then?: unknown) => {
      afterGone.closing(typeof then === "function" ? (then as () => void) : undefined);
      setOpen(false);
      for (const l of listeners.current) l(false);
      const closed = onClosed.current;
      onClosed.current = null;
      closed?.();
    },
    [afterGone],
  );
  const host = useMemo<SheetHost>(
    () => ({
      open: (next, options) => {
        for (const l of listeners.current) l(true);
        setContent(next);
        setSolid(Boolean(options?.solid));
        onClosed.current = options?.onClose ?? null;
        afterGone.opened();
        setOpen(true);
      },
      close,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [close, afterGone],
  );
  return (
    <SheetContext.Provider value={host}>
      {children}
      <Sheet open={open} onClose={close} solid={solid} onGone={gone}>
        <View style={styles.in}>{content}</View>
      </Sheet>
    </SheetContext.Provider>
  );
}

export function useSheet(): SheetHost {
  const host = useContext(SheetContext);
  if (!host) throw new Error("useSheet must be used inside SheetHostProvider");
  return host;
}

/** The screen's sheet host, or null on a screen without one (a text shown outside a conversation). */
export function useSheetIfAny(): SheetHost | null {
  return useContext(SheetContext);
}

const styles = StyleSheet.create({
  in: { gap: 12 },
});
