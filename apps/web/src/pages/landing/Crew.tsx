import { BotFace, type DougBotNome, type DougBotOpcoes, Icon } from "@dougbot/ui";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { smooth, useScrollFrame } from "./motion";

/** The team as the identity draws it (IDENTIDADE.md §6), in the order the page shows them. */
const CREW: DougBotNome[] = ["doug", "rosa", "sony", "mark", "chess", "kiara", "junin"];
const BOTS = Object.fromEntries(CREW.map((b) => [b, { bot: b }])) as Record<DougBotNome, DougBotOpcoes>;
/** The names stay the identity's own in every language. */
const NAMES: Record<DougBotNome, string> = {
  doug: "Doug",
  rosa: "Rosa",
  sony: "Sony",
  mark: "Mark",
  chess: "Chess",
  kiara: "Kiara",
  junin: "Junin",
};
/** Each bot's own color (IDENTIDADE.md §6), the light its card and the stage behind take while it is in front. */
const TONES: Record<DougBotNome, string> = {
  doug: "156 250 5",
  rosa: "236 72 153",
  sony: "34 211 238",
  mark: "251 146 60",
  chess: "167 139 250",
  kiara: "250 204 21",
  junin: "96 165 250",
};

/**
 * "O time que já vem junto": a tall section whose row of cards stays pinned while the scroll slides it sideways, one
 * bot at a time in front, lit in its color, with its trade in a line and a small picture of its work.
 * On a phone the row is a strip to swipe. With less motion the row still follows the scroll, without the lean.
 */
export function Crew() {
  const { t } = useTranslation();
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);

  const frame = useCallback((p: number, el: HTMLElement) => {
    const row = track.current;
    if (!row) return;
    // On a phone the row is a strip of its own: nothing to drive.
    if (window.innerWidth < 760) {
      row.style.transform = "";
      return;
    }
    const view = row.parentElement?.clientWidth ?? window.innerWidth;
    const span = Math.max(0, row.scrollWidth - view);
    // A little rest at both ends: the first card waits, the last one stays a moment.
    const q = smooth(Math.min(1, Math.max(0, (p - 0.06) / 0.86)));
    row.style.transform = `translate3d(${(-q * span).toFixed(1)}px, 0, 0)`;
    const at = q * (CREW.length - 1);
    el.style.setProperty("--crew-p", q.toFixed(4));
    row.querySelectorAll<HTMLElement>(".cl-crew__card").forEach((card, i) => {
      const off = i - at;
      card.style.setProperty("--off", Math.max(-1, Math.min(1, off)).toFixed(3));
      card.style.setProperty("--dist", Math.min(2, Math.abs(off)).toFixed(3));
    });
    const now = Math.round(at);
    setActive(now);
    el.style.setProperty("--tone", TONES[CREW[now] as DougBotNome]);
  }, []);
  useScrollFrame(section, frame, true);

  return (
    <section className="cl-crew" id="time" ref={section} aria-labelledby="cl-crew-title">
      <div className="cl-crew__pin">
        <div className="cl-crew__light" aria-hidden="true" />
        <header className="cl-crew__head" data-reveal>
          <p className="cl-eyebrow">{t("companies.landing.team.eyebrow")}</p>
          <h2 className="cl-h2" id="cl-crew-title">
            {t("companies.landing.team.title")}
          </h2>
          <p className="cl-lead cl-lead--sm">{t("companies.landing.team.lead")}</p>
        </header>
        <div className="cl-crew__view">
          <ol className="cl-crew__track" ref={track}>
            {CREW.map((b, i) => (
              <li
                key={b}
                className="cl-crew__card cl-glass cl-glass--thick"
                data-bot={b}
                data-on={i === active ? "" : undefined}
                style={{ "--c": TONES[b] } as CSSProperties}
              >
                <span className="cl-crew__stage" aria-hidden="true">
                  <span className="cl-crew__face">
                    <BotFace bot={BOTS[b]} guess={112} />
                  </span>
                  <Demo bot={b} />
                </span>
                <span className="cl-crew__words">
                  <span className="cl-crew__who">
                    <h3 className="cl-crew__name">{NAMES[b]}</h3>
                    <span className="cl-crew__role">{t(`companies.landing.team.members.${b}.role` as never)}</span>
                    {b === "doug" && (
                      <span className="cl-crew__chief">
                        <Icon name="crown" size={14} />
                        {t("companies.landing.team.chief")}
                      </span>
                    )}
                  </span>
                  <span className="cl-crew__text">{t(`companies.landing.team.members.${b}.text` as never)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <span className="cl-crew__dots" aria-hidden="true">
          {CREW.map((b, i) => (
            <span key={b} data-on={i === active ? "" : undefined} style={{ "--c": TONES[b] } as CSSProperties} />
          ))}
        </span>
      </div>
    </section>
  );
}

/** A small picture of each bot's work, drawn from the product's own pieces: decoration beside its words. */
function Demo({ bot }: { bot: DougBotNome }) {
  const { t } = useTranslation();
  const k = `companies.landing.team.demo.${bot}`;
  const say = (key: string) => t(`${k}.${key}` as never);
  if (bot === "doug")
    return (
      <span className="cl-demo cl-demo--list">
        <b>
          <Icon name="bell" size={14} />
          {say("title")}
        </b>
        <span data-tone="ok">
          <Icon name="check" size={14} />
          {say("one")}
        </span>
        <span data-tone="wait">
          <Icon name="clock" size={14} />
          {say("two")}
        </span>
        <span data-tone="stop">
          <Icon name="flag" size={14} />
          {say("three")}
        </span>
      </span>
    );
  if (bot === "rosa")
    return (
      <span className="cl-demo cl-demo--slides">
        <span className="cl-demo__slides">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </span>
        <small>{say("label")}</small>
      </span>
    );
  if (bot === "sony")
    return (
      <span className="cl-demo cl-demo--cut">
        <span className="cl-demo__frame">
          <Icon name="play" size={16} />
        </span>
        <span className="cl-demo__clips">
          {[0.3, 0.2, 0.28, 0.22].map((w, i) => (
            <span key={w} style={{ "--w": w, "--i": i } as CSSProperties} />
          ))}
          <i />
        </span>
      </span>
    );
  if (bot === "mark")
    return (
      <span className="cl-demo cl-demo--numbers">
        <span>
          <small>{say("cpa")}</small>
          <b>{say("cpaValue")}</b>
        </span>
        <span>
          <small>{say("roas")}</small>
          <b>{say("roasValue")}</b>
        </span>
        <svg viewBox="0 0 120 36" className="cl-demo__spark" aria-hidden="true">
          <path d="M2 30 L18 26 L32 28 L48 18 L62 21 L78 12 L94 14 L118 4" pathLength={1} />
        </svg>
      </span>
    );
  if (bot === "chess")
    return (
      <span className="cl-demo cl-demo--list">
        <b>
          <Icon name="bulb" size={14} />
          {say("hooks")}
        </b>
        {(["one", "two", "three"] as const).map((h, i) => (
          <span key={h} data-tone="plain">
            <span className="cl-demo__n">{i + 1}</span>
            {say(h)}
          </span>
        ))}
      </span>
    );
  if (bot === "kiara")
    return (
      <span className="cl-demo cl-demo--bills">
        {(["first", "second"] as const).map((n, i) => (
          <span key={n} className="cl-demo__bill">
            <Icon name="document" size={14} />
            <span>
              {say(n)}
              <small>{say("due")}</small>
            </span>
            <b>{i === 0 ? say("amount") : ""}</b>
          </span>
        ))}
        <span className="cl-demo__go">{say("approve")}</span>
      </span>
    );
  return (
    <span className="cl-demo cl-demo--code">
      <code>
        <span data-tone="del">- color: #222;</span>
        <span data-tone="add">+ color: var(--brand);</span>
      </code>
      <span data-tone="ok">
        <Icon name="check" size={14} />
        {say("tests")}
      </span>
      <span data-tone="ok">
        <Icon name="globe" size={14} />
        {say("deploy")}
      </span>
    </span>
  );
}
