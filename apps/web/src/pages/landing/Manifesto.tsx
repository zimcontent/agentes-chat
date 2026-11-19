import { BotFace, type DougBotNome } from "@dougbot/ui";
import { type CSSProperties, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useScrollFrame } from "./motion";

/** The faces that drift past the words, each at its own depth (`z`): the nearer ones cross faster. */
const DRIFT: { bot: DougBotNome; x: string; y: string; z: number; size: number }[] = [
  { bot: "rosa", x: "6%", y: "18%", z: 1.4, size: 56 },
  { bot: "sony", x: "86%", y: "12%", z: 0.8, size: 44 },
  { bot: "mark", x: "90%", y: "70%", z: 1.8, size: 64 },
  { bot: "chess", x: "10%", y: "76%", z: 0.6, size: 40 },
  { bot: "kiara", x: "48%", y: "92%", z: 1.1, size: 36 },
  { bot: "junin", x: "62%", y: "4%", z: 0.5, size: 32 },
];
const FACES = Object.fromEntries(DRIFT.map((d) => [d.bot, { bot: d.bot }]));

/**
 * One sentence that lights up word by word as the page scrolls past it, pinned while it does, with the team's faces
 * drifting by at their own depths. A language written without spaces lights up by character. With less motion every
 * word is already lit.
 */
export function Manifesto() {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const text = t("companies.landing.manifesto");
  const words = useMemo(() => {
    const byWord = text.split(/\s+/).filter(Boolean);
    return byWord.length > 3 ? byWord : Array.from(text);
  }, [text]);
  const spaced = words.length > 0 && text.includes(" ");

  const frame = useCallback((p: number, el: HTMLElement) => {
    el.style.setProperty("--mp", Math.min(1, Math.max(0, (p - 0.08) / 0.72)).toFixed(4));
    el.style.setProperty("--md", p.toFixed(4));
  }, []);
  useScrollFrame(ref, frame, true);

  return (
    <section className="cl-manifesto" ref={ref} style={{ "--n": words.length } as CSSProperties}>
      <div className="cl-manifesto__pin">
        <span className="cl-manifesto__drift" aria-hidden="true">
          {DRIFT.map((d) => (
            <span
              key={d.bot}
              className="cl-manifesto__face"
              style={{ "--x": d.x, "--y": d.y, "--z": d.z, "--s": `${d.size}px` } as CSSProperties}
            >
              <BotFace bot={FACES[d.bot] as { bot: DougBotNome }} guess={d.size} semBrilho />
            </span>
          ))}
        </span>
        <p className="cl-manifesto__text">
          {words.map((w, i) => (
            <span
              // The same word may come twice: its place in the sentence is its key.
              // biome-ignore lint/suspicious/noArrayIndexKey: the sentence's words never move
              key={i}
              className="cl-manifesto__word"
              style={{ "--i": i } as CSSProperties}
            >
              {w}
              {spaced && i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
