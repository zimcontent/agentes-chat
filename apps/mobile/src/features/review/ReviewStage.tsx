import { timecode, type VideoReviewNote } from "@dougbot/client";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { type ComponentRef, type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Icon, Text } from "@/ui";
import { useColors } from "../shared/hooks";
import { tapHaptic } from "../shared/parts";
import { fraction, pictureBox, REVIEW_FPS, ringsAt } from "./logic";
import { ownSource, useReviewWords } from "./media";

/** Where a tap on the picture asks for a note: the moment and the point on the picture. */
export interface PicturePoint {
  atMs: number;
  x: number;
  y: number;
}

/** What the screen around the player may do with it. */
export interface StageControls {
  seek: (ms: number) => void;
  pause: () => void;
  now: () => number;
}

/**
 * The Revisor's player on the phone (docs/adr/doug-0007-video-review.md): the video in its own shape, so a tap's point
 * is a point on the picture. A tap pauses it and asks for a note right there (`onPoint`); the notes' rings show
 * around their moments, the open note's ring where it was asked. Under it: play, a second and a frame back and
 * forward, the clock, and the timeline with a tick at every note.
 */
export function ReviewStage({
  uri,
  notes,
  draft,
  controls,
  onPoint,
  onTime,
  startMs = 0,
}: {
  uri: string;
  /** Where to start: the place kept when the light copy and the original (HD) swap. */
  startMs?: number;
  notes: VideoReviewNote[];
  /** The note being written, when it has a point. */
  draft: { x: number; y: number } | null;
  controls: MutableRefObject<StageControls | null>;
  onPoint: (point: PicturePoint) => void;
  onTime?: (ms: number) => void;
}) {
  const w = useReviewWords();
  const c = useColors();
  const screen = useWindowDimensions();
  // Read once per file: a renewed cookie must not load the video again mid-review.
  const source = useMemo(() => ownSource(uri), [uri]);
  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 0.1;
    p.loop = false;
  });
  const [ms, setMs] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState(9 / 16);

  useEventListener(player, "playingChange", ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, "statusChange", ({ status }) => {
    setLoading(status === "loading");
    setFailed(status === "error");
  });
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    setMs(currentTime * 1000);
    onTime?.(currentTime * 1000);
  });
  useEventListener(player, "sourceLoad", ({ duration: d, availableVideoTracks }) => {
    setDuration(d * 1000);
    if (startMs > 0) {
      player.currentTime = startMs / 1000;
      setMs(startMs);
    }
    const size = availableVideoTracks[0]?.size;
    if (size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
  });

  const seek = (to: number) => {
    const end = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const at = Math.max(0, Math.min(end, to));
    player.currentTime = at / 1000;
    setMs(at);
    onTime?.(at);
  };
  useEffect(() => {
    controls.current = {
      seek: (to) => seek(to),
      pause: () => player.pause(),
      now: () => player.currentTime * 1000,
    };
  });
  useEffect(
    () => () => {
      controls.current = null;
    },
    [controls],
  );

  const box = pictureBox(aspect, screen.width - 32, Math.round(screen.height * 0.56));
  const onPicture = (e: GestureResponderEvent) => {
    if (failed) return;
    tapHaptic();
    player.pause();
    const now = player.currentTime * 1000;
    onPoint({
      atMs: Math.round(now),
      x: fraction(e.nativeEvent.locationX / box.width),
      y: fraction(e.nativeEvent.locationY / box.height),
    });
  };
  const step = (by: number) => {
    tapHaptic();
    player.pause();
    seek(player.currentTime * 1000 + by);
  };
  const frame = 1000 / REVIEW_FPS;
  const rings = ringsAt(notes, ms);

  return (
    <View style={styles.wrap}>
      <View style={[styles.picture, { width: box.width, height: box.height }]}>
        <VideoView
          player={player}
          nativeControls={false}
          contentFit="contain"
          allowsPictureInPicture={false}
          // The size too, not only the edges: on the web a <video> keeps its own size between edges.
          style={[StyleSheet.absoluteFill, { width: box.width, height: box.height }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onPicture}
          accessibilityRole="button"
          accessibilityLabel={w.tapHint}
        />
        {rings.map((n) => (
          <Ring key={n.id} x={(n.x ?? 0) * box.width} y={(n.y ?? 0) * box.height} color="#fff" />
        ))}
        {draft ? <Ring x={draft.x * box.width} y={draft.y * box.height} color={c.green} /> : null}
        {loading && !failed ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
        {failed ? (
          <View style={styles.center} pointerEvents="none">
            <Text variant="footnote" style={styles.onBlack}>
              {w.failed}
            </Text>
          </View>
        ) : null}
      </View>

      <Timeline
        value={duration > 0 ? ms / duration : 0}
        marks={duration > 0 ? notes.filter((n) => n.atMs !== null).map((n) => (n.atMs ?? 0) / duration) : []}
        label={w.scrub}
        onSeek={(f) => seek(f * duration)}
      />

      <View style={styles.controls}>
        <Key icon="left" mark="1 s" label={w.back1s} onPress={() => step(-1000)} />
        <Key icon="left" mark="1 f" label={w.back1f} onPress={() => step(-frame)} />
        <Pressable
          onPress={() => {
            tapHaptic();
            if (player.playing) player.pause();
            else {
              if (duration > 0 && ms >= duration - 50) seek(0);
              player.play();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={playing ? w.pause : w.play}
          style={({ pressed }) => [styles.play, { backgroundColor: c.ink }, pressed && styles.pressed]}
        >
          <Icon name={playing ? "pause" : "play"} size={22} color={c.bg} />
        </Pressable>
        <Key icon="right" mark="1 f" label={w.fwd1f} onPress={() => step(frame)} />
        <Key icon="right" mark="1 s" label={w.fwd1s} onPress={() => step(1000)} />
      </View>
      <Text variant="footnote" tone="muted" style={styles.clock}>
        {`${timecode(ms)} / ${duration > 0 ? timecode(duration) : "–"}`}
      </Text>
    </View>
  );
}

/** A note's ring on the picture: where the reviewer pointed. */
function Ring({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      style={[styles.ring, { left: x - RING / 2, top: y - RING / 2, borderColor: color, shadowColor: "#000" }]}
    />
  );
}

/** A step key: which way, and how far under it (a second, or one frame). */
function Key({
  icon,
  mark,
  label,
  onPress,
}: {
  icon: "left" | "right";
  mark: string;
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.key, { backgroundColor: c.plate }, pressed && styles.pressed]}
    >
      <Icon name={icon} size={16} color={c.ink} />
      <Text variant="caption" tone="muted" style={styles.keyMark}>
        {mark}
      </Text>
    </Pressable>
  );
}

/** The timeline: a touch or a drag moves through the video; a tick marks every note's moment. */
function Timeline({
  value,
  marks,
  label,
  onSeek,
}: {
  value: number;
  marks: number[];
  label: string;
  onSeek: (fraction: number) => void;
}) {
  const c = useColors();
  const box = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef({ x: 0, width: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => {
    const { x, width } = frame.current;
    return width > 0 ? fraction((e.nativeEvent.pageX - x) / width) : 0;
  };
  const shown = fraction(drag ?? value);
  return (
    <View
      ref={box}
      style={styles.track}
      onLayout={() => box.current?.measureInWindow((x, _y, width) => (frame.current = { x, width }))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        box.current?.measureInWindow((x, _y, width) => (frame.current = { x, width }));
        const f = at(e);
        setDrag(f);
        onSeek(f);
      }}
      onResponderMove={(e) => {
        const f = at(e);
        setDrag(f);
        onSeek(f);
      }}
      onResponderRelease={(e) => {
        onSeek(at(e));
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onSeek(fraction(value + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05)))}
    >
      <View style={[styles.line, { backgroundColor: c.plate }]}>
        <View style={[styles.filled, { width: `${shown * 100}%`, backgroundColor: c.ink }]} />
      </View>
      {marks.map((m, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: the ticks of one timeline, in the notes' order
          key={i}
          pointerEvents="none"
          style={[styles.mark, { left: `${fraction(m) * 100}%`, backgroundColor: c.amber }]}
        />
      ))}
      <View style={[styles.knob, { left: `${shown * 100}%`, backgroundColor: c.ink, borderColor: c.raised }]} />
    </View>
  );
}

const RING = 44;

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8 },
  picture: { backgroundColor: "#000", borderRadius: 16, overflow: "hidden" },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  onBlack: { color: "#fff", textAlign: "center" },
  ring: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  track: { alignSelf: "stretch", height: 34, justifyContent: "center", marginHorizontal: 6 },
  line: { height: 4, borderRadius: 999, overflow: "hidden" },
  filled: { height: 4 },
  mark: { position: "absolute", top: 9, width: 3, height: 16, marginLeft: -1.5, borderRadius: 2 },
  knob: {
    position: "absolute",
    top: 10,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    borderWidth: 2,
  },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  key: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  keyMark: { fontVariant: ["tabular-nums"], lineHeight: 14 },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.95 }] },
  clock: { fontVariant: ["tabular-nums"] },
});
