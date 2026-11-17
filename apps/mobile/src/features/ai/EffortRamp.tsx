import { type AgentBrainInput, type BrainKind, type BrainScope, keys, useApi } from "@agenteschat/client";
import { type EffortLevel, effortLevelsOf, effortTextOf } from "@agenteschat/client/lib/brain-advanced";
import { AUTO } from "@agenteschat/client/lib/providers";
import { bodyTones } from "@agenteschat/ui/agent/engine";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AccessibilityActionEvent, Pressable, StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useOrg } from "@/providers/org";
import { haptics, Text, useReducedMotion, useTheme, useToast } from "@/ui";
import { effortReach, effortStep } from "./effort";

const HEIGHT = 46;
const FILL_SPRING = { stiffness: 220, damping: 22, mass: 1 };

/**
 * How much an agent thinks, a ramp of rounded bars (DougBot: no pixels), rising step by step, filled in the agent's color
 * up to the chosen step, under the finger and on the UI thread, with a tick at each step; the step's name and what it means
 * follow. Drag or tap the ramp, or tap a name; it says the choice when let go. Still with reduced motion. `kind`: what
 * the agent thinks with (an API key takes fewer levels); `value` null: none chosen, the ramp stays empty.
 */
export function EffortRamp({
  value,
  onChange,
  color,
  kind,
  disabled = false,
}: {
  value: EffortLevel | null;
  onChange: (level: EffortLevel) => void;
  color: Parameters<typeof bodyTones>[0];
  kind?: BrainKind;
  disabled?: boolean;
}) {
  const levels = effortLevelsOf(kind);
  const STEPS = levels.length;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const index = value ? levels.indexOf(value) : -1;
  const [shown, setShown] = useState(index);
  const [width, setWidth] = useState(0);
  const pos = useSharedValue(index + 1);
  const track = useSharedValue(0);
  const step = useSharedValue(index);

  const land = (to: number) => {
    pos.value = reduced ? to + 1 : withSpring(to + 1, FILL_SPRING);
  };
  // A choice from outside: a saved one, or one that failed and went back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `land` is the same but for `reduced`
  useEffect(() => {
    setShown(index);
    step.value = index;
    land(index);
  }, [index, step]);

  const stepped = (to: number) => {
    setShown(to);
    haptics.selection();
  };
  const choose = (to: number) => {
    setShown(to);
    land(to);
    const level = levels[to];
    if (level && level !== value) onChange(level);
  };
  const follow = (x: number) => {
    "worklet";
    const reach = effortReach(x, track.value, STEPS);
    pos.value = reach;
    const to = effortStep(reach, STEPS);
    if (to !== step.value) {
      step.value = to;
      scheduleOnRN(stepped, to);
    }
  };
  const pan = usePanGesture({
    enabled: !disabled,
    // Sideways only: a vertical drag stays the screen's scroll.
    activeOffsetX: [-3, 3],
    failOffsetY: [-14, 14],
    maxPointers: 1,
    onActivate: (e) => {
      "worklet";
      follow(e.x);
    },
    onUpdate: (e) => {
      "worklet";
      follow(e.x);
    },
    onDeactivate: () => {
      "worklet";
      scheduleOnRN(choose, step.value);
    },
  });
  const tap = useTapGesture({
    enabled: !disabled,
    onDeactivate: (e) => {
      "worklet";
      if (e.canceled) return;
      const to = effortStep(effortReach(e.x, track.value, STEPS), STEPS);
      if (to !== step.value) {
        step.value = to;
        scheduleOnRN(stepped, to);
      }
      scheduleOnRN(choose, to);
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const tones = bodyTones(color);
  const fill = tones[1] ?? colors.ink;

  const label = t("agentPage.work.brain.effort");
  const level = levels[shown] ?? null;
  const name = t(`agentPage.work.brain.efforts.${level ?? "none"}`);
  const onAction = (e: AccessibilityActionEvent) => {
    const by = e.nativeEvent.actionName === "increment" ? 1 : e.nativeEvent.actionName === "decrement" ? -1 : 0;
    const to = Math.min(STEPS - 1, Math.max(0, index + by));
    if (!disabled && to !== index) choose(to);
  };

  return (
    <View
      style={[styles.ramp, disabled && styles.off]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: name }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={onAction}
    >
      <View style={styles.head}>
        <Text variant="subhead" style={styles.bold}>
          {label}
        </Text>
        <Text variant="subhead" style={styles.bold}>
          {name}
        </Text>
      </View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={styles.track}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            track.value = w;
            setWidth(w);
          }}
        >
          {width > 0
            ? levels.map((e, i) => <EffortBar key={e} i={i} steps={STEPS} pos={pos} fill={fill} off={colors.line} />)
            : null}
        </Animated.View>
      </GestureDetector>
      <View style={styles.names}>
        {levels.map((e, i) => (
          <Pressable
            key={e}
            onPress={() => {
              if (disabled) return;
              if (i !== shown) stepped(i);
              choose(i);
            }}
            // 44 pt to the finger: the room under the name, never over the ramp's own drag.
            hitSlop={{ bottom: 16 }}
            style={({ pressed }) => [styles.name, pressed && i !== shown ? styles.pressed : null]}
          >
            <Text variant="caption" tone={i === shown ? "ink" : "faint"} style={i === shown && styles.bold}>
              {t(`agentPage.work.brain.efforts.${e}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text variant="footnote" tone="muted" numberOfLines={2} style={styles.hint}>
        {t(`agentPage.work.brain.effortText.${effortTextOf(kind, level)}`)}
      </Text>
    </View>
  );
}

/** One step of the ramp: a rounded bar, taller each step, filled as far as `pos` reaches it (on the UI thread). */
function EffortBar({
  i,
  steps,
  pos,
  fill,
  off,
}: {
  i: number;
  steps: number;
  pos: SharedValue<number>;
  fill: string;
  off: string;
}) {
  const height = Math.round(HEIGHT * (0.3 + (0.7 * i) / Math.max(1, steps - 1)));
  const inner = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, pos.value - i)) * 100}%` }));
  return (
    <View style={[styles.bar, { height, backgroundColor: off }]}>
      <Animated.View style={[styles.barFill, { backgroundColor: fill }, inner]} />
    </View>
  );
}

/**
 * The ramp's choice, saved when let go: it stays on the ramp while the server answers, and a change made in the
 * meantime goes next, so the last one wins. Only a failure speaks.
 */
export const useEffortChoice = (agentId: string, saved: EffortLevel | null | undefined, scope?: BrainScope) =>
  useBrainChoice<EffortLevel | null>(
    agentId,
    saved === undefined ? "medium" : saved,
    (effort) => ({ effort: effort ?? AUTO }),
    scope,
  );

/**
 * One choice of the agent's brain that shows at once and saves in the background: the last one wins, and a save that
 * fails goes back to what is saved and says so. `scope`: which of the right hand's two AIs (its own cache entry).
 */
export function useBrainChoice<V>(agentId: string, saved: V, input: (value: V) => AgentBrainInput, scope?: BrainScope) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<V | null>(null);
  const sending = useRef(false);
  const next = useRef<V | null>(null);
  const send = async (value: V) => {
    sending.current = true;
    try {
      qc.setQueryData(
        scope ? [...keys.agentBrain(orgId, agentId), scope] : keys.agentBrain(orgId, agentId),
        await api.agents.setBrain(orgId, agentId, { ...(scope ? { scope } : {}), ...input(value) }),
      );
    } catch {
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    }
    sending.current = false;
    const queued = next.current;
    next.current = null;
    if (queued !== null) return void send(queued);
    setDraft(null);
    for (const key of [keys.agentBrain(orgId, agentId), keys.agents(orgId)])
      void qc.invalidateQueries({ queryKey: key });
  };
  const change = (value: V) => {
    setDraft(value);
    if (sending.current) next.current = value;
    else void send(value);
  };
  return { value: draft ?? saved, change };
}

const styles = StyleSheet.create({
  ramp: { gap: 8 },
  off: { opacity: 0.55 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  bold: { fontWeight: "600" },
  track: { height: HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 6 },
  bar: { flex: 1, borderRadius: 8, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 8 },
  names: { flexDirection: "row", marginTop: -2 },
  name: { flex: 1, alignItems: "center", paddingVertical: 6 },
  pressed: { opacity: 0.6 },
  // Two lines' room: the words change under the finger and nothing around them moves.
  hint: { minHeight: 36 },
});
