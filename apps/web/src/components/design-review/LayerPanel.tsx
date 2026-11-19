import type { FrameLayer, LayerInfo, LayerPatch } from "@dougbot/client/lib/design-bridge";
import { Button, Icon, Segmented, Textarea } from "@dougbot/ui";
import { useEffect, useRef, useState } from "react";
import type { ReviewWords } from "@/components/video-review/words";

/*
 * The editor's side panel (docs/adr/doug-0010-design-review.md): saving, the history, what is selected and how it can
 * change, and the slide's layers. It only asks; the piece does the change (`bridge.ts`) and reports back.
 */

function Slider({
  label,
  value,
  min,
  max,
  unit,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  step?: number;
  onChange: (v: number) => void;
}) {
  // The thumb follows the hand; the piece hears it as one step of the history (`key`).
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="dr-field">
      <span className="dr-field__line">
        <span>{label}</span>
        <span className="dr-field__value">
          {v}
          {unit}
        </span>
      </span>
      <input
        type="range"
        className="dr-range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          onChange(n);
        }}
      />
    </label>
  );
}

function Colors({
  label,
  value,
  colors,
  onChange,
}: {
  label: string;
  value: string | null;
  colors: string[];
  onChange: (hex: string) => void;
}) {
  return (
    <div className="dr-field">
      <span className="dr-field__line">
        <span>{label}</span>
        <span className="dr-field__value">{value ?? ""}</span>
      </span>
      <div className="dr-swatches">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className="dr-swatch"
            style={{ background: c }}
            aria-label={c}
            aria-pressed={value?.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="dr-swatch dr-swatch--pick" aria-label={label}>
          <Icon name="plus" size={14} />
          <input
            type="color"
            value={value ?? "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="dr-swatch__input"
          />
        </label>
      </div>
    </div>
  );
}

export function LayerPanel({
  w,
  version,
  layers,
  selected,
  count,
  adding,
  onAdding,
  colors,
  history,
  saving,
  saveNote,
  onSaveNote,
  onSelect,
  onToggle,
  onPatch,
  onParent,
  onRewrite,
  onPhoto,
  onUndo,
  onRedo,
  onSave,
  onDiscard,
  onDone,
}: {
  w: ReviewWords;
  version: number;
  layers: FrameLayer[];
  selected: LayerInfo | null;
  /** How many things are selected (Shift+click, or "Select several" on a phone). */
  count: number;
  adding: boolean;
  onAdding: (on: boolean) => void;
  colors: string[];
  history: { changes: number; undo: boolean; redo: boolean };
  saving: boolean;
  saveNote: string;
  onSaveNote: (v: string) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onPatch: (patch: LayerPatch) => void;
  onParent: () => void;
  onRewrite: () => void;
  onPhoto: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onDone: () => void;
}) {
  const d = w.design;
  const file = useRef<HTMLInputElement>(null);
  const s = selected;
  const dirty = history.changes > 0;
  return (
    <div className="vr-side dr-panel">
      <div className="dr-panel__save">
        <div className="dr-panel__line">
          <Button
            size="sm"
            variant="ghost"
            icon="undo"
            iconOnly
            aria-label={d.undo}
            disabled={!history.undo}
            onClick={onUndo}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="undo"
            iconOnly
            className="dr-redo"
            aria-label={d.redo}
            disabled={!history.redo}
            onClick={onRedo}
          />
          <span className="vr-muted dr-panel__changes">{dirty ? d.unsaved(history.changes) : ""}</span>
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              {d.discard}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onDone}>
              {d.done}
            </Button>
          )}
        </div>
        {dirty && (
          <>
            <Textarea value={saveNote} rows={1} placeholder={d.saveNote} onChange={(e) => onSaveNote(e.target.value)} />
            <Button variant="primary" icon="check" loading={saving} onClick={onSave}>
              {d.saveAs(version + 1)}
            </Button>
          </>
        )}
      </div>

      <section className="dr-panel__section" aria-label={d.selected}>
        <Button
          size="sm"
          variant={adding ? "primary" : "default"}
          icon="layers"
          aria-pressed={adding}
          onClick={() => onAdding(!adding)}
        >
          {adding ? d.severalOn : d.several}
        </Button>
        {!s ? (
          <p className="vr-muted">{d.noSelection}</p>
        ) : count > 1 ? (
          <>
            <span className="dr-panel__title">{d.count(count)}</span>
            <div className="dr-acts">
              <Button size="sm" icon="arrowUp" onClick={() => onPatch({ z: 1 })}>
                {d.forward}
              </Button>
              <Button size="sm" icon="arrowDown" onClick={() => onPatch({ z: -1 })}>
                {d.backward}
              </Button>
              <Button size="sm" icon={s.hidden ? "eye" : "eyeOff"} onClick={() => onPatch({ hidden: !s.hidden })}>
                {s.hidden ? d.show : d.hide}
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => onPatch({ reset: true })}>
                {d.reset}
              </Button>
            </div>
            <Slider
              label={d.opacity}
              value={s.opacity}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onPatch({ opacity: v, key: "opacity" })}
            />
          </>
        ) : (
          <>
            <div className="dr-panel__line">
              <span className="dr-layer__name dr-panel__title">{s.name}</span>
            </div>
            <div className="dr-acts">
              <Button size="sm" icon="arrowUp" onClick={() => onPatch({ z: 1 })}>
                {d.forward}
              </Button>
              <Button size="sm" icon="arrowDown" onClick={() => onPatch({ z: -1 })}>
                {d.backward}
              </Button>
              <Button size="sm" icon={s.hidden ? "eye" : "eyeOff"} onClick={() => onPatch({ hidden: !s.hidden })}>
                {s.hidden ? d.show : d.hide}
              </Button>
              {s.parent && (
                <Button size="sm" icon="layers" onClick={onParent}>
                  {d.group}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => onPatch({ reset: true })}>
                {d.reset}
              </Button>
            </div>

            {s.kind === "text" &&
              (s.text !== null ? (
                <div className="dr-field">
                  <span className="dr-field__line">{d.text}</span>
                  <Textarea
                    aria-label={d.text}
                    value={s.text}
                    rows={Math.min(5, Math.max(2, s.text.split("\n").length))}
                    onChange={(e) => onPatch({ text: e.target.value, key: "text" })}
                  />
                </div>
              ) : (
                <Button size="sm" icon="edit" onClick={onRewrite}>
                  {d.rewrite}
                </Button>
              ))}
            {s.kind === "text" && (
              <>
                <Slider
                  label={d.size}
                  value={s.fontSize}
                  min={6}
                  max={Math.max(240, s.fontSize * 2)}
                  unit="px"
                  onChange={(v) => onPatch({ fontSize: v, key: "fontSize" })}
                />
                <Colors
                  label={d.color}
                  value={s.color}
                  colors={colors}
                  onChange={(c) => onPatch({ color: c, key: "color" })}
                />
              </>
            )}
            {s.kind === "shape" && (
              <Colors
                label={d.color}
                value={s.fill}
                colors={colors}
                onChange={(c) => onPatch({ fill: c, key: "fill" })}
              />
            )}
            {s.image && (
              <div className="dr-field">
                <span className="dr-field__line">{d.photo}</span>
                <div className="dr-acts">
                  <Button size="sm" icon="swap" onClick={() => file.current?.click()}>
                    {d.swap}
                  </Button>
                  <Segmented
                    label={d.framing}
                    size="sm"
                    value={s.image.fit === "contain" ? "contain" : "cover"}
                    onValueChange={(v) => onPatch({ fit: v })}
                    options={[
                      { value: "cover", label: d.fill },
                      { value: "contain", label: d.fit },
                    ]}
                  />
                </div>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPhoto(f);
                    e.target.value = "";
                  }}
                />
                <Slider
                  label={`${d.framing} ↔`}
                  value={s.image.x}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => onPatch({ posX: v, key: "posX" })}
                />
                <Slider
                  label={`${d.framing} ↕`}
                  value={s.image.y}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => onPatch({ posY: v, key: "posY" })}
                />
              </div>
            )}
            <Slider
              label={d.size}
              value={s.scale}
              min={10}
              max={400}
              unit="%"
              onChange={(v) => onPatch({ scale: v, key: "scale" })}
            />
            <Slider
              label={d.rotation}
              value={s.rotate}
              min={-180}
              max={180}
              unit="°"
              onChange={(v) => onPatch({ rotate: v, key: "rotate" })}
            />
            <Slider
              label={d.opacity}
              value={s.opacity}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onPatch({ opacity: v, key: "opacity" })}
            />
          </>
        )}
      </section>

      <section className="dr-panel__section" aria-label={d.layers}>
        <h2 className="vr-notes__title">{d.layers}</h2>
        {layers.length === 0 ? (
          <p className="vr-muted">{d.noLayers}</p>
        ) : (
          <ul className="dr-layers">
            {layers.map((l) => (
              <li
                key={l.id}
                className="dr-layer"
                data-chosen={s?.id === l.id || undefined}
                data-hidden={l.hidden || undefined}
              >
                <button type="button" className="dr-layer__pick" onClick={() => onSelect(l.id)}>
                  <Icon name={l.kind === "image" ? "image" : l.kind === "text" ? "note" : "grid"} size={16} />
                  <span className="dr-layer__name">{l.name}</span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={l.hidden ? "eyeOff" : "eye"}
                  iconOnly
                  aria-label={l.hidden ? d.show : d.hide}
                  onClick={() => onToggle(l.id, !l.hidden)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
