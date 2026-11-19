import { useSaveDesign, useVideoReview } from "@dougbot/client";
import type { FrameLayer, FrameMessage, LayerInfo, LayerPatch } from "@dougbot/client/lib/design-bridge";
import { errorText } from "@dougbot/client/lib/errors";
import * as ImagePicker from "expo-image-picker";
import { usePreventRemove } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Glass, Icon, type IconName, Sheet, Text, useFieldText, useTheme, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useOrgId } from "../shared/hooks";
import { PushedHeader, successHaptic, tapHaptic } from "../shared/parts";
import { type PieceHandle, PieceView, usePieceSource } from "./DesignPiece";
import { clampStep, editable } from "./design-logic";
import { useReviewWords } from "./media";

/*
 * The piece in the editor, on the phone (docs/adr/doug-0010-design-review.md). The page is the piece itself in a web
 * view, where the fingers work on it: a tap selects, a drag moves, two fingers resize and turn, a double tap rewrites
 * a text. The panel under it does the rest (`design-bridge`, the same editor as the web's): the order, hiding, size,
 * turn, opacity, colors from the piece's own, the text in a field, a photo from the phone. "Salvar como V2" saves the
 * page as the next version, with the notes not sent yet.
 */

/** A small labelled − / + pair: steps the phone's thumb can hit, in place of a slider. */
function Stepper({
  label,
  value,
  unit,
  onStep,
}: {
  label: string;
  value: number;
  unit: string;
  onStep: (dir: 1 | -1) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.stepper, { backgroundColor: c.plate }]}>
      <Pressable onPress={() => onStep(-1)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} −`}>
        <Text variant="body" style={styles.stepGlyph}>
          −
        </Text>
      </Pressable>
      <View style={styles.stepWords}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="footnote" style={styles.bold}>{`${value}${unit}`}</Text>
      </View>
      <Pressable onPress={() => onStep(1)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} +`}>
        <Text variant="body" style={styles.stepGlyph}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

function Chipish({ icon, label, on, onPress }: { icon: IconName; label: string; on?: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={on === undefined ? undefined : { selected: on }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: on ? c.chosen : c.plate, borderColor: on ? c.greenText : "transparent" },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={16} color={c.ink} />
      <Text variant="footnote" style={styles.bold}>
        {label}
      </Text>
    </Pressable>
  );
}

export function DesignEditor({ id, version }: { id: string; version: number }) {
  const w = useReviewWords();
  const d = w.design;
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const toast = useToast();
  const field = useFieldText("body");
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const review = useVideoReview(orgId, id).data;
  const source = usePieceSource(id, version, true);
  const save = useSaveDesign(orgId, id);
  const piece = useRef<PieceHandle>(null);
  const [slide, setSlide] = useState(1);
  const [slides, setSlides] = useState(1);
  const [colors, setColors] = useState<string[]>([]);
  const [layers, setLayers] = useState<FrameLayer[]>([]);
  const [sel, setSel] = useState<LayerInfo | null>(null);
  const [count, setCount] = useState(0);
  const [history, setHistory] = useState({ changes: 0, undo: false, redo: false });
  const [adding, setAdding] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [text, setText] = useState("");
  const pending = useRef<{ req: number; resolve: (html: string) => void } | null>(null);
  const done = useRef(false);
  const dirty = history.changes > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: another layer selected starts from its own words
  useEffect(() => {
    if (sel?.text !== null && sel?.text !== undefined) setText(sel.text);
  }, [sel?.id, sel?.text]);

  // Leaving with changes asks first.
  usePreventRemove(dirty && !done.current, ({ repeat }) => {
    if (done.current) return repeat();
    Alert.alert(d.discardConfirm, undefined, [
      { text: w.cancel, style: "cancel" },
      { text: d.discard, style: "destructive", onPress: repeat },
    ]);
  });

  const send = (cmd: Parameters<PieceHandle["send"]>[0]) => piece.current?.send(cmd);
  const patch = (p: LayerPatch) => {
    if (sel) send({ ed: "set", id: sel.id, patch: p });
  };
  const go = (n: number) => {
    const next = Math.max(1, Math.min(slides, n));
    setSlide(next);
    send({ ed: "slide", slide: next });
  };
  // The stage's room above the panel, and the slide's shape: the piece fits both (the panel grows as it offers more).
  const [room, setRoom] = useState(0);
  const [shape, setShape] = useState(1350 / 1080);
  const onMessage = (m: FrameMessage) => {
    if (m.ed === "ready" || m.ed === "slide") setShape(m.h / m.w);
    if (m.ed === "ready") {
      setSlides(m.slides);
      setColors(m.colors);
    } else if (m.ed === "layers") setLayers(m.layers);
    else if (m.ed === "selected") {
      setSel(m.info);
      setCount(m.count);
    } else if (m.ed === "history") setHistory({ changes: m.changes, undo: m.undo, redo: m.redo });
    else if (m.ed === "page" && pending.current?.req === m.req) {
      pending.current.resolve(m.html);
      pending.current = null;
    }
  };

  const swapPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, base64: true });
    const a = res.canceled ? null : res.assets[0];
    if (!a?.base64) return;
    // A phone photo inlined into the page: kept under a few megabytes so the piece stays light to save and open.
    if (a.base64.length > 6 * 1024 * 1024) {
      toast({ title: w.uploadFailed, icon: "x" });
      return;
    }
    patch({ src: `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}` });
  };

  const saveAs = () => {
    const req = Date.now();
    const html = new Promise<string>((resolve, reject) => {
      pending.current = { req, resolve };
      setTimeout(() => {
        if (pending.current?.req === req) {
          pending.current = null;
          reject(new Error("the piece did not answer"));
        }
      }, 15_000);
    });
    send({ ed: "serialize", req });
    html.then(
      (page) =>
        save.mutate(
          { baseVersion: version, html: page },
          {
            onSuccess: (r) => {
              successHaptic();
              done.current = true;
              toast({ title: d.saved(r.version), icon: "check" });
              router.back();
            },
            onError: (e: unknown) =>
              toast({
                title: (e as { code?: string }).code === "video_review.stale_version" ? d.stale : errorText(t, e),
                icon: "x",
              }),
          },
        ),
      () => toast({ title: w.failed, icon: "x" }),
    );
  };

  if (!review || !source.data) {
    return (
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <PushedHeader title={d.edit} solid={false} />
        <View style={styles.center}>
          {source.isError ? (
            <Text tone="muted">{d.failedLoad}</Text>
          ) : (
            <>
              <ActivityIndicator color={c.muted} />
              <Text variant="footnote" tone="muted">
                {d.loading}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }
  if (!editable(review, version)) {
    return (
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <PushedHeader title={d.edit} solid={false} />
        <View style={styles.center}>
          <Text tone="muted" style={styles.centerText}>
            {d.editClosed}
          </Text>
        </View>
      </View>
    );
  }

  const width = Math.max(120, Math.floor(Math.min(screen - 32, room > 0 ? (room - 32) / shape : screen)));
  const step = (key: "scale" | "rotate" | "opacity" | "fontSize", by: number, min: number, max: number) => {
    if (!sel) return;
    tapHaptic();
    patch({ [key]: clampStep(sel[key], by, min, max), key } as LayerPatch);
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <PushedHeader title={review.title} subtitle={`${d.edit} · ${w.version(version)}`} solid={false} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.stage, { backgroundColor: c.sunken }]}
        // The fingers belong to the piece while editing: the screen doesn't scroll under a drag.
        scrollEnabled={false}
        onLayout={(e) => setRoom(e.nativeEvent.layout.height)}
      >
        <PieceView ref={piece} html={source.data} width={width} slide={slide} mode="edit" onMessage={onMessage} />
      </ScrollView>

      <Glass style={[styles.panel, { paddingBottom: insets.bottom + 8, borderColor: c.glassEdge }]}>
        <View style={styles.line}>
          <Pressable
            onPress={() => send({ ed: "undo" })}
            disabled={!history.undo}
            accessibilityRole="button"
            accessibilityLabel={d.undo}
            hitSlop={8}
            style={!history.undo && styles.off}
          >
            <Icon name="undo" size={20} color={c.ink} />
          </Pressable>
          <Pressable
            onPress={() => send({ ed: "redo" })}
            disabled={!history.redo}
            accessibilityRole="button"
            accessibilityLabel={d.redo}
            hitSlop={8}
            style={[styles.flip, !history.redo && styles.off]}
          >
            <Icon name="undo" size={20} color={c.ink} />
          </Pressable>
          <Text variant="caption" tone="muted" style={styles.grow} numberOfLines={1}>
            {dirty ? d.unsaved(history.changes) : d.slide(slide, slides)}
          </Text>
          {slides > 1 ? (
            <>
              <Pressable
                onPress={() => go(slide - 1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={d.prev}
              >
                <Icon name="left" size={20} color={slide > 1 ? c.ink : c.faint} />
              </Pressable>
              <Pressable
                onPress={() => go(slide + 1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={d.next}
              >
                <Icon name="right" size={20} color={slide < slides ? c.ink : c.faint} />
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={() => setShowLayers(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={d.layers}
          >
            <Icon name="list" size={20} color={c.ink} />
          </Pressable>
        </View>

        <View style={styles.chips}>
          <Chipish
            icon="checks"
            label={adding ? d.severalOn : d.several}
            on={adding}
            onPress={() => {
              send({ ed: "adding", on: !adding });
              setAdding(!adding);
            }}
          />
          {sel ? (
            <>
              <Chipish icon="up" label={d.forward} onPress={() => patch({ z: 1 })} />
              <Chipish icon="down" label={d.backward} onPress={() => patch({ z: -1 })} />
              <Chipish
                icon={sel.hidden ? "eye" : "eyeoff"}
                label={sel.hidden ? d.show : d.hide}
                onPress={() => patch({ hidden: !sel.hidden })}
              />
              {count < 2 && sel.kind === "text" && sel.text === null ? (
                <Chipish icon="text" label={d.rewrite} onPress={() => send({ ed: "text" })} />
              ) : null}
              {count < 2 && sel.image ? (
                <Chipish icon="photos" label={d.swap} onPress={() => void swapPhoto()} />
              ) : null}
              {count < 2 && sel.parent ? (
                <Chipish icon="checks" label={d.group} onPress={() => send({ ed: "parent" })} />
              ) : null}
              <Chipish icon="replay" label={d.reset} onPress={() => patch({ reset: true })} />
            </>
          ) : null}
        </View>

        {sel ? (
          <>
            <Text variant="footnote" style={styles.bold} numberOfLines={1}>
              {count > 1 ? d.count(count) : sel.name}
            </Text>
            {count < 2 && sel.kind === "text" && sel.text !== null ? (
              <TextInput
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  patch({ text: v, key: "text" });
                }}
                accessibilityLabel={d.text}
                multiline
                style={[styles.input, field, { color: c.ink, backgroundColor: c.sunken }]}
              />
            ) : null}
            <View style={styles.chips}>
              {count < 2 ? (
                <>
                  <Stepper label={d.size} value={sel.scale} unit="%" onStep={(s) => step("scale", s * 5, 5, 400)} />
                  {sel.kind === "text" ? (
                    <Stepper
                      label={d.text}
                      value={sel.fontSize}
                      unit="px"
                      onStep={(s) => step("fontSize", s * 2, 6, 400)}
                    />
                  ) : null}
                  <Stepper
                    label={d.rotation}
                    value={sel.rotate}
                    unit="°"
                    onStep={(s) => step("rotate", s * 5, -180, 180)}
                  />
                </>
              ) : null}
              <Stepper label={d.opacity} value={sel.opacity} unit="%" onStep={(s) => step("opacity", s * 10, 0, 100)} />
            </View>
            {count < 2 && (sel.kind === "text" || sel.kind === "shape") && colors.length > 0 ? (
              <View style={styles.chips}>
                {colors.map((hex) => {
                  const on = (sel.kind === "text" ? sel.color : sel.fill)?.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => {
                        tapHaptic();
                        patch(sel.kind === "text" ? { color: hex, key: "color" } : { fill: hex, key: "fill" });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${d.color} ${hex}`}
                      accessibilityState={{ selected: on }}
                      style={[styles.swatch, { backgroundColor: hex, borderColor: on ? c.green : c.line }]}
                    />
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <Text variant="footnote" tone="muted">
            {d.noSelection}
          </Text>
        )}

        {/* Only once something changed: an untouched piece has nothing to save. */}
        {dirty ? (
          <Button variant="primary" wide label={d.saveAs(version + 1)} loading={save.isPending} onPress={saveAs} />
        ) : null}
      </Glass>

      <Sheet open={showLayers} onClose={() => setShowLayers(false)} solid>
        <View style={styles.layers}>
          <Text variant="subhead" style={styles.bold}>
            {d.layers}
          </Text>
          {layers.length === 0 ? (
            <Text variant="footnote" tone="muted">
              {d.noLayers}
            </Text>
          ) : (
            layers.map((l) => (
              <View key={l.id} style={[styles.layer, sel?.id === l.id && { backgroundColor: c.chosen }]}>
                <Pressable
                  style={styles.layerPick}
                  onPress={() => {
                    tapHaptic();
                    send({ ed: "select", id: l.id });
                    setShowLayers(false);
                  }}
                  accessibilityRole="button"
                >
                  <Icon
                    name={l.kind === "image" ? "image" : l.kind === "text" ? "text" : "circle"}
                    size={16}
                    color={c.muted}
                  />
                  <Text variant="body" tone={l.hidden ? "muted" : "ink"} numberOfLines={1} style={styles.grow}>
                    {l.name}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => send({ ed: "set", id: l.id, patch: { hidden: !l.hidden } })}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={l.hidden ? d.show : d.hide}
                >
                  <Icon name={l.hidden ? "eyeoff" : "eye"} size={18} color={c.muted} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 },
  centerText: { textAlign: "center" },
  stage: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  panel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 16 },
  grow: { flex: 1, minWidth: 0 },
  off: { opacity: 0.35 },
  flip: { transform: [{ scaleX: -1 }] },
  // Rows that wrap: every control in sight on the narrowest phone, nothing past the edge.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  pressed: { opacity: 0.75 },
  bold: { fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingHorizontal: 12, borderRadius: 12 },
  stepGlyph: { fontSize: 22, fontWeight: "600", width: 18, textAlign: "center" },
  stepWords: { alignItems: "center", minWidth: 64 },
  input: { minHeight: 44, maxHeight: 96, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  swatch: { width: 32, height: 32, borderRadius: 8, borderWidth: 2 },
  layers: { paddingHorizontal: 16, paddingBottom: 16, gap: 4 },
  layer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderRadius: 10, minHeight: 44 },
  layerPick: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
});
