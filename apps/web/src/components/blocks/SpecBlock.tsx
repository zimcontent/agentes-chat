import { type BlockChange, newClientId, useBlockReply, useBlockValues } from "@agenteschat/client";
import type { ChartSpec } from "@agenteschat/client/lib/chart";
import { formatTime } from "@agenteschat/client/lib/format";
import { Button, Field, Input, Segmented, Switch, Textarea, widgetTones } from "@agenteschat/ui";
import {
  type BlockViewPart,
  type BlockWords,
  compileBlock,
  inputValue,
  type MarkedText,
  parseBlockSpec,
  viewBlock,
} from "@agenteschat/ui/blocks/spec";
import {
  type CSSProperties,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ChartAccent, ChartView } from "@/components/ChartBlock";
import { useOrg } from "@/components/org-context";
import { chartColorOf } from "@/components/Sky";
import { useDirectory } from "@/hooks/useDirectory";
import { useReveal } from "@/hooks/useReveal";
import { copyText } from "@/lib/context-menu";
import { useDarkTheme } from "@/lib/grow";
import { useToast } from "@/lib/toast";
import "./spec-block.css";

/** A button's message to the agent (`say`), sent at once, and which of the block's buttons already sent theirs. */
const Say = createContext<{ say: (key: string, text: string) => void; said: ReadonlySet<string>; busy: boolean }>({
  say: () => {},
  said: new Set(),
  busy: false,
});

/** In the conversation a block is at most this tall; a taller one is cut with a fade until "Show all". */
const INLINE_HEIGHT = 420;

type Sent = { text: string; at: string };
/** What this person sent from a block and whether they opened it whole, kept while the conversation is open. */
const kept = new Map<string, { sent?: Sent; open?: boolean; said?: Set<string> }>();
const keptOf = (key: string) => {
  let k = kept.get(key);
  if (!k) {
    k = {};
    kept.set(key, k);
  }
  return k;
};

/**
 * A live block drawn by the app itself (ADR 0113): the parts the agent described, with the app's own controls, over
 * the state everyone in the conversation shares. Nothing the agent wrote runs here: its words reach the screen only
 * as text, and its formulas are read by our interpreter (`@agenteschat/ui/blocks/spec`).
 */
export function SpecBlock({
  id,
  version,
  spec: raw,
  agentId,
  big = false,
}: {
  id: string;
  version: number;
  spec: Record<string, unknown>;
  agentId: string;
  big?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const agent = dir.anyAgent(agentId);
  const toast = useToast();
  const blockKey = `${id}@${version}`;
  const compiled = useMemo(() => {
    try {
      return compileBlock(parseBlockSpec(raw));
    } catch {
      return null;
    }
  }, [raw]);
  const values = useBlockValues(org.id, id, version);
  const reply = useBlockReply(org.id, id);
  const thousand = t("blocks.thousand");
  const words = useMemo<BlockWords>(() => ({ locale: i18n.language, thousand }), [i18n.language, thousand]);
  const view = useMemo(
    () => (compiled ? viewBlock(compiled, values.state, words) : null),
    [compiled, values.state, words],
  );
  const [sent, setSent] = useState<Sent | null>(keptOf(blockKey).sent ?? null);
  const [open, setOpen] = useState(keptOf(blockKey).open ?? false);
  const [said, setSaid] = useState<ReadonlySet<string>>(() => new Set(keptOf(blockKey).said));
  const dark = useDarkTheme();
  const tones = widgetTones(chartColorOf(agent), dark);
  const shown = useRef<HTMLDivElement>(null);
  const reveal = useReveal(shown, open);
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!compiled || !view) {
    return (
      <div className="live-block__broken">
        <span>
          <b>{t("blocks.brokenTitle")}</b>
          <small>{t("blocks.brokenBody")}</small>
        </span>
      </div>
    );
  }

  const tall = !big && height > INLINE_HEIGHT;
  const openWhole = () => {
    reveal();
    keptOf(blockKey).open = true;
    setOpen(true);
  };
  const send = () => {
    const draft = view.send;
    if (!draft?.ready || reply.isPending) return;
    const text = draft.text;
    reply.mutate(
      { text, clientId: newClientId() },
      {
        onSuccess: () => {
          const done = { text, at: new Date().toISOString() };
          keptOf(blockKey).sent = done;
          setSent(done);
        },
        onError: () => toast.show(t("blocks.sendFailed"), "error"),
      },
    );
  };
  const same = sent !== null && sent.text === view.send?.text;
  const say = (key: string, text: string) => {
    if (reply.isPending) return;
    reply.mutate(
      { text, clientId: crypto.randomUUID() },
      {
        onSuccess: () => {
          const next = new Set(said).add(key);
          keptOf(blockKey).said = next;
          setSaid(next);
        },
        onError: () => toast.show(t("blocks.sendFailed"), "error"),
      },
    );
  };

  return (
    <ChartAccent.Provider value={chartColorOf(agent)}>
      <div
        ref={shown}
        className="live-block__view"
        data-cut={(tall && !open) || undefined}
        style={big || !tall ? undefined : { height: open ? height : INLINE_HEIGHT }}
      >
        <div
          ref={body}
          className="spec-block"
          style={{ "--block-accent": tones.fill, "--block-accent-ink": tones.stroke } as CSSProperties}
        >
          <Say.Provider value={{ say, said, busy: reply.isPending }}>
            <Parts parts={view.parts} values={values} />
          </Say.Provider>
        </div>
      </div>
      {tall && !open && (
        <div className="live-block__more">
          <Button variant="ghost" size="sm" icon="chevronDown" onClick={openWhole}>
            {t("channel.long.more")}
          </Button>
        </div>
      )}
      {view.send &&
        (same ? (
          <div className="live-block__foot">
            <span className="live-block__sent">
              <span className="live-block__mark" aria-hidden="true" />
              {t("blocks.sentAt", { time: formatTime(i18n.language, sent.at) })}
            </span>
          </div>
        ) : (
          <div className="live-block__foot">
            <span className="live-block__draft">
              {view.send.ready ? (
                <>
                  {t("blocks.goesTo", { name: agent?.name ?? t("channel.unknownAgent") })} <b>{view.send.text}</b>
                </>
              ) : (
                view.send.hint
              )}
            </span>
            <Button variant="primary" size="sm" disabled={!view.send.ready || reply.isPending} onClick={send}>
              {view.send.label}
            </Button>
          </div>
        ))}
    </ChartAccent.Provider>
  );
}

type Values = ReturnType<typeof useBlockValues>;

function Parts({ parts, values }: { parts: BlockViewPart[]; values: Values }) {
  return (
    <>
      {parts.map((p) => (
        <Part key={p.key} part={p} values={values} />
      ))}
    </>
  );
}

function Part({ part: p, values }: { part: BlockViewPart; values: Values }) {
  const id = useId();
  const speak = useContext(Say);
  const set = (raw: unknown) => {
    const name = "name" in p ? p.name : undefined;
    if (typeof name !== "string") return;
    const v = inputValue(p, raw);
    if (v !== undefined) values.set({ [name]: v });
  };
  switch (p.kind) {
    case "heading":
      return <h3 className="spec-block__heading">{p.text}</h3>;
    case "text":
      return <p className="spec-block__text">{p.text}</p>;
    case "note":
      return <p className="spec-block__note">{p.text}</p>;
    case "list":
      return (
        <ul className="spec-block__list">
          {p.items.map((item, i) => (
            // Lines of one list have no id but their place.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "slider": {
      const pct = ((p.value - p.min) / (p.max - p.min)) * 100;
      return (
        <label className="spec-block__slider" htmlFor={id}>
          <span className="spec-block__label">
            <span>{p.label}</span>
            <b>{p.shown}</b>
          </span>
          <input
            id={id}
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={p.value}
            style={{ "--p": `${pct}%` } as CSSProperties}
            onChange={(e) => set(e.target.value)}
          />
        </label>
      );
    }
    case "choice":
      return (
        <div className="spec-block__choice">
          {p.label && <div className="spec-block__title">{p.label}</div>}
          <Segmented
            size="sm"
            label={p.label || p.options.join(", ")}
            value={p.value ?? ""}
            onValueChange={(v) => set(v)}
            options={p.options.map((o) => ({ value: o, label: o }))}
          />
        </div>
      );
    case "field":
      return (
        <Field label={p.label}>
          {p.input === "textarea" ? (
            <Textarea value={p.value} placeholder={p.placeholder} onChange={(e) => set(e.target.value)} />
          ) : (
            <Input
              type={p.input}
              inputMode={p.input === "number" ? "decimal" : undefined}
              value={p.value}
              placeholder={p.placeholder}
              onChange={(e) => set(e.target.value)}
            />
          )}
        </Field>
      );
    case "switch":
      return (
        <div className="spec-block__switch">
          <label htmlFor={id}>{p.label}</label>
          <Switch id={id} checked={p.value} onCheckedChange={(v) => set(v)} />
        </div>
      );
    case "stats":
      return (
        <div className="spec-block__stats">
          {p.items.map((s) => (
            <div key={s.key} className="spec-block__stat" data-tone={s.tone ?? undefined}>
              <span>{s.label}</span>
              <b>{s.text}</b>
              {s.sub && <small>{s.sub}</small>}
            </div>
          ))}
        </div>
      );
    case "result":
      return <Result label={p.label} text={p.text} change={p.name ? values.changes[p.name] : undefined} />;
    case "progress":
      return (
        <div className="spec-block__progress">
          <span className="spec-block__label">
            <span>{p.label}</span>
            <b>{p.text}</b>
          </span>
          <span className="spec-block__track">
            <span style={{ width: `${p.share * 100}%` }} />
          </span>
        </div>
      );
    case "chart":
      return <BlockChart part={p} />;
    case "table":
      return (
        <div className="md__table spec-block__table">
          <table>
            <thead>
              <tr>
                {p.columns.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns have no id but their place
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id but their place
                <tr key={r}>
                  {row.map((cell, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "more":
      return (
        <details className="spec-block__more">
          <summary>{p.label || <MoreLabel />}</summary>
          <div className="spec-block__more-body">
            <Parts parts={p.parts} values={values} />
          </div>
        </details>
      );
    case "row":
      return (
        <div className="spec-block__row">
          <Parts parts={p.parts} values={values} />
        </div>
      );
    case "card": {
      const head = (p.label || p.sub) && (
        <div className="spec-block__card-head">
          {p.label && <b>{p.label}</b>}
          {p.sub && <small>{p.sub}</small>}
        </div>
      );
      if (!p.pick) {
        return (
          <div className="spec-block__card" data-on={p.selected || undefined}>
            {head}
            <Parts parts={p.parts} values={values} />
          </div>
        );
      }
      const pick = p.pick;
      return (
        // A card that is a choice holds parts (a stat, a note) a button can't: a pressable group instead.
        // biome-ignore lint/a11y/useSemanticElements: see above
        <div
          className="spec-block__card"
          role="button"
          tabIndex={0}
          aria-pressed={p.selected}
          data-pick=""
          data-on={p.selected || undefined}
          onClick={() => values.set({ [pick.name]: pick.value })}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            values.set({ [pick.name]: pick.value });
          }}
        >
          {head}
          <Parts parts={p.parts} values={values} />
        </div>
      );
    }
    case "actions":
      return (
        <div className="spec-block__actions" data-align={p.align}>
          {p.buttons.map((b, i) => {
            const said = speak.said.has(b.key);
            // A row of buttons that speak for the person: the last one is the main answer ("Aprovar").
            const lead = b.lead || (b.say !== null && i === p.buttons.length - 1);
            return (
              <Button
                key={b.key}
                variant={lead ? "primary" : "default"}
                icon={said ? "check" : undefined}
                disabled={said || (b.say !== null && speak.busy)}
                onClick={() => {
                  if (b.set) values.set(b.set);
                  if (b.draw) void values.draw(b.draw.name, b.draw.options);
                  if (b.say) speak.say(b.key, b.say);
                }}
              >
                {said ? <SaidLabel /> : b.label}
              </Button>
            );
          })}
        </div>
      );
    case "tags":
      return (
        <div className="spec-block__tags">
          {p.items.map((tag, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tags have no id but their place
            <span key={i} data-lead={i === 0 || undefined}>
              {tag}
            </span>
          ))}
        </div>
      );
    case "hook":
      return (
        <div className="spec-block__hook">
          {p.label && <div className="spec-block__eyebrow">{p.label}</div>}
          <p>
            <Marked text={p.text} />
          </p>
        </div>
      );
    case "slides":
      return <Slides part={p} />;
    case "poster":
      return (
        <div className="spec-block__poster">
          {p.eyebrow && <span className="spec-block__poster-eyebrow">{p.eyebrow}</span>}
          <b className="spec-block__poster-title">
            <Marked text={p.title} />
          </b>
          {p.sub && <span className="spec-block__poster-sub">{p.sub}</span>}
          {p.button && <span className="spec-block__poster-button">{p.button}</span>}
        </div>
      );
    case "fields":
      return (
        <dl className="spec-block__fields">
          {p.items.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one list, in order
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "copy":
      return <CopyText label={p.label} text={p.text} />;
    case "timeline":
      return (
        <div className="spec-block__timeline">
          {p.label && <div className="spec-block__eyebrow">{p.label}</div>}
          <ol>
            {p.items.map((x, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the beats of one script, in order
              <li key={i} data-lead={i === 0 || undefined}>
                <span className="spec-block__time">{x.time}</span>
                <span className="spec-block__beat">
                  {x.text}
                  {x.note && <small>{x.note}</small>}
                </span>
                {x.screen && <span className="spec-block__screen">{x.screen}</span>}
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

/** A text with its marked words highlighted in the agent's color. */
function Marked({ text }: { text: MarkedText }) {
  return (
    <>
      {text.before}
      {text.mark && <mark>{text.mark}</mark>}
      {text.after}
    </>
  );
}

/** A carousel's slides side by side, scrolled sideways; the tagged ones (cover, call to action) stand out. */
function Slides({ part }: { part: Extract<BlockViewPart, { kind: "slides" }> }) {
  return (
    <div className="spec-block__slides-wrap">
      {part.label && <div className="spec-block__eyebrow">{part.label}</div>}
      <ol className="spec-block__slides">
        {part.items.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the slides of one carousel, in order
          <li key={i} data-tagged={x.tag ? "" : undefined} data-first={i === 0 || undefined}>
            <span className="spec-block__slide-n">
              {String(i + 1).padStart(2, "0")}
              {x.tag && ` · ${x.tag}`}
            </span>
            <b>{x.title}</b>
            {x.text && <small>{x.text}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Text to paste as is (a caption), with its Copy button on the label's line. */
function CopyText({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="spec-block__copy">
      <div className="spec-block__copy-head">
        <span className="spec-block__eyebrow">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? "check" : "copy"}
          onClick={() => void copyText(text, () => setCopied(true))}
        >
          {copied ? t("blocks.copied") : t("blocks.copy")}
        </Button>
      </div>
      <p>{text}</p>
    </div>
  );
}

function SaidLabel() {
  const { t } = useTranslation();
  return <>{t("blocks.said")}</>;
}

function MoreLabel() {
  const { t } = useTranslation();
  return <>{t("blocks.more")}</>;
}

/** The block's answer, large. A value the server just drew rolls into place, the same moment for everyone. */
function Result({ label, text, change }: { label: string; text: string; change: BlockChange | undefined }) {
  const first = useRef(true);
  const [roll, setRoll] = useState(0);
  // A new draw is a new `at`.
  const drawnAt = change?.drawn ? change.at : null;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (drawnAt) setRoll((n) => n + 1);
  }, [drawnAt]);
  return (
    <div className="spec-block__result">
      <span>{label}</span>
      <b key={roll} data-roll={roll > 0 || undefined} aria-live="polite">
        {text}
      </b>
    </div>
  );
}

/** A chart in the block, in the style of a message's chart. Too few points to draw shows nothing. */
function BlockChart({ part }: { part: Extract<BlockViewPart, { kind: "chart" }> }) {
  const spec: ChartSpec = {
    type: part.chart,
    title: part.label,
    labels: part.labels,
    series: [{ name: "", values: part.values }],
    ...(part.unit ? { unit: part.unit } : {}),
  };
  const enough =
    part.chart === "bar"
      ? part.values.length >= 1
      : part.values.length >= 2 && (part.chart !== "pie" || part.values.some((v) => v > 0));
  if (!enough) return null;
  return (
    <figure className="spec-block__chart">
      {part.label && <figcaption className="spec-block__title">{part.label}</figcaption>}
      <ChartView
        spec={
          part.chart === "pie"
            ? { ...spec, series: [{ name: "", values: part.values.map((v) => Math.max(0, v)) }] }
            : spec
        }
      />
    </figure>
  );
}
