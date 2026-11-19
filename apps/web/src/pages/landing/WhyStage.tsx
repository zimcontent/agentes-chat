import { Avatar, BotFace, type DougBotOpcoes, Icon } from "@dougbot/ui";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WhatsAppMark } from "@/components/whatsapp/WhatsAppMark";
import { clamp01, mix, prefersLessMotion, smooth, useScrollFrame } from "./motion";

const DOUG: DougBotOpcoes = { bot: "doug" };
const ROSA: DougBotOpcoes = { bot: "rosa" };
const MARK: DougBotOpcoes = { bot: "mark" };
const SONY: DougBotOpcoes = { bot: "sony" };

/**
 * The four things the team does, in the order the camera visits them (each with its key in
 * `companies.landing.pillars`): running the business, the built-in agency, the company's WhatsApp, and the client's
 * approval link.
 */
const STEPS = ["ops", "agency", "whatsapp", "portal"] as const;
type Step = (typeof STEPS)[number];

/**
 * Where each scene stands in the world (points and degrees). The camera faces one at a time: it moves the world by
 * the opposite of the scene's place and turn, so the scene lands in the middle of the stage, square to the eye.
 */
const PLACES: Record<Step, { x: number; y: number; z: number; ry: number }> = {
  ops: { x: 0, y: 0, z: 0, ry: 0 },
  agency: { x: 1020, y: -150, z: -560, ry: -34 },
  whatsapp: { x: 1960, y: 110, z: 120, ry: 26 },
  portal: { x: 2860, y: -70, z: -460, ry: -20 },
};

/**
 * "Por que o DougBot": a tall section whose stage stays pinned while the page scrolls through it. The scroll drives a
 * camera across a 3D world of four glass scenes (the business's board, the agency's video review, WhatsApp, the
 * client's approval link): it rests on each one, and between two it cranes back and swings, the way a film camera moves from
 * one set to the next. The words beside it follow the scene in view. With less motion the camera still follows the
 * scroll, without the crane and the swing.
 */
export function WhyStage() {
  const { t } = useTranslation();
  const section = useRef<HTMLElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const calm = useRef<boolean | null>(null);

  const frame = useCallback((p: number, el: HTMLElement) => {
    calm.current ??= prefersLessMotion();
    const last = STEPS.length - 1;
    // Each scene holds the middle half of its stretch: the camera rests there, then travels.
    const at = p * last;
    const from = Math.min(last, Math.floor(at));
    const to = Math.min(last, from + 1);
    const travel = smooth(clamp01((at - from - 0.25) / 0.5));
    const a = PLACES[STEPS[from] as Step];
    const b = PLACES[STEPS[to] as Step];
    const x = mix(a.x, b.x, travel);
    const y = mix(a.y, b.y, travel);
    const z = mix(a.z, b.z, travel);
    const ry = mix(a.ry, b.ry, travel);
    const arc = calm.current ? 0 : Math.sin(Math.PI * travel);
    const crane = -arc * 520;
    const tilt = arc * 9;
    const roll = arc * (from % 2 === 0 ? -2.5 : 2.5);
    const node = world.current;
    if (node)
      node.style.transform = `translateZ(${crane.toFixed(1)}px) rotateX(${tilt.toFixed(2)}deg) rotateZ(${roll.toFixed(2)}deg) rotateY(${(-ry).toFixed(2)}deg) translate3d(${(-x).toFixed(1)}px, ${(-y).toFixed(1)}px, ${(-z).toFixed(1)}px)`;
    // How near the camera each scene is, for its light: 1 in view, 0 a scene away.
    const focus = from + travel;
    STEPS.forEach((_, i) => {
      el.style.setProperty(`--near-${i}`, (1 - Math.min(1, Math.abs(focus - i))).toFixed(3));
    });
    el.style.setProperty("--why-p", p.toFixed(4));
    setActive(Math.round(focus));
  }, []);
  useScrollFrame(section, frame, true);

  return (
    <section className="cl-why" id="diferenca" ref={section} aria-labelledby="cl-why-title">
      <div className="cl-why__pin">
        <div className="cl-why__text">
          <p className="cl-eyebrow">{t("companies.landing.why.eyebrow")}</p>
          <h2 className="cl-h2" id="cl-why-title">
            {t("companies.landing.why.title")}
          </h2>
          <ol className="cl-why__steps">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className="cl-why__step"
                data-on={i === active ? "" : undefined}
                aria-current={i === active ? "step" : undefined}
              >
                <span className="cl-why__n" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="cl-why__words">
                  <span className="cl-why__title">{t(`companies.landing.pillars.${s}.title` as never)}</span>
                  <span className="cl-why__body">{t(`companies.landing.pillars.${s}.text` as never)}</span>
                </span>
              </li>
            ))}
          </ol>
          <span className="cl-why__rail" aria-hidden="true">
            <span />
          </span>
        </div>
        <div className="cl-why__stage" aria-hidden="true">
          <div className="cl-why__glow" />
          <div className="cl-why__lens">
            <div className="cl-why__world" ref={world}>
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`cl-scene cl-scene--${s}`}
                  style={
                    {
                      "--near": `var(--near-${i})`,
                      transform: `translate(-50%, -50%) translate3d(${PLACES[s].x}px, ${PLACES[s].y}px, ${PLACES[s].z}px) rotateY(${PLACES[s].ry}deg)`,
                    } as CSSProperties
                  }
                >
                  {s === "ops" && <OpsScene />}
                  {s === "agency" && <VideoScene />}
                  {s === "whatsapp" && <WhatsAppScene />}
                  {s === "portal" && <PortalScene />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The timeline's pieces, as shares of its width: the cut's clips, the caption's lines and the sound. */
const CLIPS = [
  { id: "a", w: 0.18 },
  { id: "b", w: 0.26 },
  { id: "c", w: 0.14 },
  { id: "d", w: 0.24 },
  { id: "e", w: 0.18 },
];
const WORDS = [
  { id: "a", w: 0.2 },
  { id: "b", w: 0.3 },
  { id: "c", w: 0.22 },
];
const WAVE = Array.from({ length: 48 }, (_, i) => ({ id: `w${i}`, h: 0.25 + Math.abs(Math.sin(i * 1.7) * 0.75) }));

/** Where the review's notes sit on the timeline, as a share of the video, and the second each one reads. */
const NOTES = [
  { at: 0.12, time: "0:04", key: "note1", who: "Ana" },
  { at: 0.66, time: "0:21", key: "note2", who: "Leo" },
] as const;

/**
 * The video review (docs/adr/doug-0007-video-review.md): the cut in its player, the timeline with its tracks and a
 * playhead that runs, notes pinned to their second, and the two answers. Sony edited it.
 */
function VideoScene() {
  const { t } = useTranslation();
  const k = "companies.landing.scenes.video";
  return (
    <div className="cl-editor">
      <div className="cl-editor__box cl-glass cl-glass--thick">
        <span className="cl-editor__top">
          <Icon name="video" size={14} />
          <span className="cl-editor__file">{t(`${k}.file` as never)}</span>
          <span className="cl-tag">V2</span>
          <span className="cl-editor__where">{t(`${k}.review` as never)}</span>
        </span>
        <span className="cl-editor__player">
          <span className="cl-editor__shot" />
          <span className="cl-editor__caption">{t(`${k}.caption` as never)}</span>
          <span className="cl-editor__play">
            <Icon name="play" size={18} />
          </span>
          <span className="cl-editor__time">0:12 / 0:32</span>
        </span>
        <span className="cl-editor__tracks">
          <span className="cl-editor__track cl-editor__track--clips">
            {CLIPS.map((c, i) => (
              <span key={c.id} style={{ "--w": c.w, "--i": i } as CSSProperties} />
            ))}
          </span>
          <span className="cl-editor__track cl-editor__track--words">
            {WORDS.map((c) => (
              <span key={c.id} style={{ "--w": c.w } as CSSProperties} />
            ))}
          </span>
          <span className="cl-editor__track cl-editor__track--wave">
            {WAVE.map((b) => (
              <span key={b.id} style={{ "--h": b.h.toFixed(2) } as CSSProperties} />
            ))}
          </span>
          {NOTES.map((n, i) => (
            <span key={n.key} className="cl-editor__pin" style={{ "--at": n.at } as CSSProperties}>
              {i + 1}
            </span>
          ))}
          <span className="cl-editor__head" />
        </span>
        <span className="cl-editor__acts">
          <span className="cl-portal__btn">{t(`${k}.askChanges` as never)}</span>
          <span className="cl-portal__btn cl-portal__btn--go">
            <Icon name="check" size={14} />
            {t("companies.landing.chat.approve")}
          </span>
        </span>
      </div>
      {NOTES.map((n, i) => (
        <span key={n.key} className={`cl-chip cl-glass cl-editor__note cl-editor__note--${i + 1}`}>
          <Avatar kind="person" name={n.who} size="xs" />
          <span className="cl-editor__stamp">{n.time}</span>
          {t(`${k}.${n.key}` as never)}
        </span>
      ))}
      <span className="cl-chip cl-glass cl-editor__by">
        <BotFace bot={SONY} guess={24} semBrilho className="cl-chip__face" />
        {t(`${k}.by` as never)}
      </span>
    </div>
  );
}

/** The board's cards: which column, which business, who is on it. */
const CARDS: { key: string; col: "todo" | "doing" | "done"; bot: DougBotOpcoes }[] = [
  { key: "t1", col: "todo", bot: { bot: "kiara" } },
  { key: "t3", col: "todo", bot: { bot: "mark" } },
  { key: "t2", col: "doing", bot: ROSA },
  { key: "t4", col: "doing", bot: { bot: "junin" } },
  { key: "t5", col: "done", bot: { bot: "chess" } },
  { key: "t6", col: "done", bot: DOUG },
];

/**
 * Running the business: several companies in one place (the switcher on top), the week's tasks on a board with the
 * bot on each, one moving to done, and the Doug's line on what he split.
 */
function OpsScene() {
  const { t } = useTranslation();
  const k = "companies.landing.scenes.ops";
  return (
    <div className="cl-ops">
      <div className="cl-ops__box cl-glass cl-glass--thick">
        <span className="cl-ops__orgs">
          {(["a", "b", "c"] as const).map((o, i) => (
            <span
              key={o}
              className="cl-ops__org"
              data-on={i === 0 ? "" : undefined}
              style={{ "--i": i } as CSSProperties}
            >
              <span className="cl-ops__dot" />
              {t(`${k}.${o}` as never)}
            </span>
          ))}
        </span>
        <span className="cl-ops__board">
          {(["todo", "doing", "done"] as const).map((col) => (
            <span key={col} className="cl-ops__col" data-col={col}>
              <span className="cl-ops__head">{t(`${k}.${col}` as never)}</span>
              {CARDS.filter((c) => c.col === col).map((c) => (
                <span key={c.key} className="cl-ops__card">
                  {t(`${k}.${c.key}` as never)}
                  <BotFace bot={c.bot} guess={20} semBrilho className="cl-ops__face" />
                </span>
              ))}
            </span>
          ))}
        </span>
      </div>
      <span className="cl-chip cl-glass cl-ops__brief">
        <BotFace bot={DOUG} guess={24} semBrilho className="cl-chip__face" />
        {t(`${k}.brief` as never)}
      </span>
    </div>
  );
}

/** A phone on the company's number: a client asks, the agent answers in the company's voice. */
function WhatsAppScene() {
  const { t } = useTranslation();
  const k = "companies.landing.scenes.whatsapp";
  return (
    <div className="cl-phone">
      <div className="cl-phone__body">
        <div className="cl-phone__screen">
          <span className="cl-phone__head">
            <span className="cl-phone__wa">
              <WhatsAppMark size={16} />
            </span>
            <span className="cl-phone__who">
              <b>{t(`${k}.contact` as never)}</b>
              <small>{t(`${k}.online` as never)}</small>
            </span>
          </span>
          <span className="cl-phone__chat">
            <span className="cl-bubble cl-bubble--in">{t(`${k}.ask` as never)}</span>
            <span className="cl-bubble cl-bubble--out">
              {t(`${k}.answer` as never)}
              <small>{t(`${k}.via` as never)}</small>
            </span>
            <span className="cl-typing">
              <span />
              <span />
              <span />
            </span>
          </span>
        </div>
      </div>
      <span className="cl-phone__agent cl-glass">
        <BotFace bot={MARK} guess={28} semBrilho className="cl-phone__face" />
        {t(`${k}.agent` as never)}
      </span>
    </div>
  );
}

/** The client's own page: the week's posts and the two answers, no account needed. */
function PortalScene() {
  const { t } = useTranslation();
  const k = "companies.landing.scenes.portal";
  return (
    <div className="cl-portal cl-glass cl-glass--thick">
      <span className="cl-portal__url">
        <Icon name="link" size={14} />
        {t(`${k}.url` as never)}
      </span>
      <span className="cl-portal__head">
        <b>{t(`${k}.title` as never)}</b>
        <span className="cl-portal__status">{t(`${k}.status` as never)}</span>
      </span>
      <span className="cl-portal__team">
        <Icon name="checks" size={14} />
        {t(`${k}.team` as never)}
      </span>
      <span className="cl-portal__grid">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="cl-portal__post" style={{ "--i": i } as CSSProperties} />
        ))}
      </span>
      <span className="cl-portal__acts">
        <span className="cl-portal__btn cl-portal__btn--go">
          <Icon name="check" size={14} />
          {t("companies.landing.chat.approve")}
        </span>
        <span className="cl-portal__btn">{t(`${k}.adjust` as never)}</span>
      </span>
      <span className="cl-portal__by">
        <BotFace bot={ROSA} guess={24} semBrilho className="cl-portal__face" />
        {t(`${k}.by` as never)}
      </span>
    </div>
  );
}
