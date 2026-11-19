import { Avatar, BotFace, Button, type DougBotNome, type DougBotOpcoes, Icon, Logo } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "@/components/LanguageSelect";
import { Crew } from "./landing/Crew";
import { DougLogo, type DougLogoHandle } from "./landing/DougLogo";
import { GlassField } from "./landing/GlassField";
import { Manifesto } from "./landing/Manifesto";
import { clamp01, mix, prefersLessMotion, smooth, usePointer, useReveal, useScrollFrame } from "./landing/motion";
import { WhyStage } from "./landing/WhyStage";
import "./companies-landing.css";

/** The team as the identity draws it (IDENTIDADE.md §6), in the order the page shows them. */
const TEAM: DougBotNome[] = ["doug", "rosa", "sony", "mark", "chess", "kiara", "junin"];
/** One drawing option per bot, made once: `BotFace` redraws when its `bot` changes. */
const BOTS = Object.fromEntries(TEAM.map((b) => [b, { bot: b }])) as Record<DougBotNome, DougBotOpcoes>;
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

/** The comparison's rows: what a cloud bot service does (from its own page), and what DougBot does instead. */
const ROWS = ["where", "talk", "setup", "price"] as const;
const STEPS = ["join", "talk", "install"] as const;

/** What the team is doing, on the moving strip under the hero: who, which line, and in which state. */
type State = "done" | "working" | "waiting";
const ACTIVITY: { bot: DougBotNome; key: string; state: State }[] = [
  { bot: "rosa", key: "a", state: "done" },
  { bot: "sony", key: "b", state: "working" },
  { bot: "mark", key: "c", state: "waiting" },
  { bot: "kiara", key: "d", state: "done" },
  { bot: "junin", key: "e", state: "working" },
  { bot: "chess", key: "f", state: "done" },
  { bot: "doug", key: "g", state: "working" },
];

/** The glass cards that float around the hero's window, each at its own depth (`z`) so they part as the page moves. */
const FLOATERS: { bot: DougBotNome; key: string; state: State; className: string; z: number }[] = [
  { bot: "rosa", key: "a", state: "done", className: "cl-float--a", z: 1 },
  { bot: "mark", key: "c", state: "waiting", className: "cl-float--b", z: 1.6 },
  { bot: "sony", key: "b", state: "working", className: "cl-float--c", z: 0.7 },
];

/** The bots that circle the Doug's icon in the hero, the team that comes with him. */
const ORBIT: DougBotNome[] = ["rosa", "sony", "mark", "chess", "kiara", "junin"];

/**
 * The public landing of `/empresas` (ADR doug-0033): what the team does that a chat of bots doesn't, the team that
 * comes with it, how DougBot differs from cloud bot services, how a company gets it, and the waiting list (`form`,
 * the company request the page has always taken). Always on the identity's dark stage, in glass: the Doug's icon comes
 * in and flies to the bar as the page moves, a field of shards swirls around the pointer, a window the scroll brings
 * level, a sentence that lights up word by word, a camera that travels between four scenes, the team sliding by, and
 * pieces that come in as they reach the screen. Every piece that moves by itself stops with less motion. The window,
 * the scenes and the cards are drawings of the product, not live data.
 */
export function CompaniesLanding({ form, done }: { form: ReactNode; done: boolean }) {
  const { t } = useTranslation();
  const page = useRef<HTMLDivElement>(null);
  useReveal(page);

  return (
    <div className="cl" data-theme="dark" ref={page}>
      <Bar />
      <main>
        <Hero />
        <Activity />
        <Manifesto />
        <WhyStage />
        <Crew />
        <Compare />
        <Steps />

        <section className="cl-section cl-join" id="lista" aria-labelledby="cl-join">
          <div className="cl-join__aura" aria-hidden="true" />
          <div className="cl-join__text" data-reveal>
            <DougLogo className="cl-join__doug" face={done ? "happy" : "normal"} intro={false} />
            <SectionHead
              id="cl-join"
              eyebrow={t("companies.landing.join.eyebrow")}
              title={done ? t("companies.page.doneTitle") : t("companies.landing.join.title")}
              lead={done ? t("companies.page.doneLead") : t("companies.landing.join.lead")}
            />
            <ul className="cl-join__points">
              {(["one", "two", "three"] as const).map((k) => (
                <li key={k}>
                  <Icon name="check" size={16} />
                  {t(`companies.landing.join.points.${k}` as never)}
                </li>
              ))}
            </ul>
            <span className="cl-join__team" aria-hidden="true">
              {TEAM.map((b, i) => (
                <span key={b} className="cl-join__face" style={{ "--beat": `${-i * 0.45}s` } as CSSProperties}>
                  <BotFace bot={BOTS[b]} guess={40} semBrilho />
                </span>
              ))}
            </span>
          </div>
          <JoinCard>{form}</JoinCard>
        </section>
      </main>

      <footer className="cl-foot">
        <span className="cl-foot__brand">
          <Logo size={20} />
          <span>{t("companies.landing.foot.line")}</span>
        </span>
        <span className="cl-foot__links">
          <Link className="ac-link" to="/privacidade">
            {t("companies.page.privacy")}
          </Link>
          <Link className="ac-link" to="/login">
            {t("companies.landing.nav.signIn")}
          </Link>
        </span>
      </footer>
    </div>
  );
}

/** The floating glass bar: the logo, the sections, the language, sign in and the list. */
function Bar() {
  const { t } = useTranslation();
  return (
    <header className="cl-bar">
      <div className="cl-bar__in cl-glass">
        <Link to="/" className="cl-bar__logo" aria-label={t("companies.landing.home")}>
          <Logo size={24} />
        </Link>
        <nav className="cl-bar__nav" aria-label={t("companies.landing.navLabel")}>
          <a href="#diferenca">{t("companies.landing.nav.difference")}</a>
          <a href="#time">{t("companies.landing.nav.team")}</a>
          <a href="#como">{t("companies.landing.nav.how")}</a>
        </nav>
        <span className="cl-bar__end">
          <span className="cl-bar__lang">
            <LanguageSelect signedIn={false} align="end" />
          </span>
          <Button asChild size="sm" variant="ghost" className="cl-bar__signin">
            <Link to="/login">{t("companies.landing.nav.signIn")}</Link>
          </Button>
          <Button asChild size="sm" variant="primary" className="cl-bar__join">
            <a href="#lista">{t("companies.landing.nav.join")}</a>
          </Button>
        </span>
      </div>
    </header>
  );
}

/**
 * The Doug's icon over the hero, big, with the team in orbit round it. As the page starts to move it shrinks and flies
 * up into the bar, where the brand's mark stands, and stays there, still blinking and looking at the pointer. The
 * icon is drawn fixed over the page and placed on each frame between the hero's spot and the bar's mark; with less
 * motion it stays in the hero and the bar keeps its own mark.
 */
function Emblem() {
  const spot = useRef<HTMLDivElement>(null);
  const logo = useRef<DougLogoHandle>(null);
  useEffect(() => {
    const at = spot.current;
    const el = logo.current?.el;
    const page = at?.closest<HTMLElement>(".cl");
    if (!at || !el || !page || prefersLessMotion()) return;
    page.dataset.dock = "";
    el.classList.add("dl--flying");
    let raf = 0;
    const place = () => {
      raf = 0;
      const mark = page.querySelector<HTMLElement>(".cl-bar__logo .ac-logo__mark");
      const from = at.getBoundingClientRect();
      const to = mark?.getBoundingClientRect();
      if (!to || from.width === 0) return;
      // Docked once the page has moved a little over half a screen.
      const t = smooth(clamp01(window.scrollY / (window.innerHeight * 0.55)));
      el.style.width = `${from.width}px`;
      el.style.height = `${from.height}px`;
      // Never above the bar: once the hero has carried it up there, it slides along the bar into its place.
      const y = Math.max(to.top, mix(from.top, to.top, t));
      el.style.transform = `translate3d(${mix(from.left, to.left, t).toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${mix(1, to.width / from.width, t).toFixed(4)})`;
      el.style.setProperty("--dock", t.toFixed(3));
      if (t > 0.98) el.dataset.docked = "";
      else delete el.dataset.docked;
    };
    const ask = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(ask) : null;
    ro?.observe(at);
    // The page's own width changes when its scrollbar comes, which moves the hero without resizing the window.
    ro?.observe(page);
    void document.fonts?.ready.then(ask);
    // The bar's language and buttons settle after the first paint: place it again once they have.
    const late = window.setTimeout(ask, 400);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro?.disconnect();
      window.removeEventListener("scroll", ask);
      window.removeEventListener("resize", ask);
      delete page.dataset.dock;
      el.classList.remove("dl--flying");
      el.style.cssText = "";
    };
  }, []);

  return (
    <div className="cl-emblem">
      <span className="cl-emblem__ring" aria-hidden="true">
        <span className="cl-emblem__orbit">
          {ORBIT.map((b, i) => (
            <span key={b} className="cl-emblem__sat" style={{ "--i": i, "--n": ORBIT.length } as CSSProperties}>
              <span className="cl-emblem__bot">
                <BotFace bot={BOTS[b]} guess={44} semBrilho />
              </span>
            </span>
          ))}
        </span>
      </span>
      <div className="cl-emblem__spot" ref={spot}>
        <DougLogo ref={logo} className="cl-emblem__logo" />
      </div>
    </div>
  );
}

/**
 * The hero: the Doug's icon, the words, then the app's window tilted back in 3D. Scrolling brings the window level and toward the
 * eye (the camera dollies in), the floating cards part at their own depths, and the pointer leans everything a
 * little, as through a lens.
 */
function Hero() {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  usePointer(ref);
  const frame = useCallback((p: number, el: HTMLElement) => {
    // The hero starts at the page's top, so its progress starts near the middle: stretched to 0→1 from there.
    el.style.setProperty("--hp", Math.min(1, Math.max(0, (p - 0.45) / 0.4)).toFixed(4));
  }, []);
  useScrollFrame(ref, frame);

  return (
    <section className="cl-hero" ref={ref}>
      <GlassField className="cl-hero__field" />
      <div className="cl-hero__aurora" aria-hidden="true" />
      <Emblem />
      <div className="cl-hero__text">
        <p className="cl-eyebrow cl-rise" style={{ "--d": 0 } as CSSProperties}>
          <span className="cl-dot" aria-hidden="true" />
          {t("companies.landing.hero.eyebrow")}
        </p>
        <h1 className="cl-title cl-rise" style={{ "--d": 1 } as CSSProperties}>
          {t("companies.landing.hero.title")}
        </h1>
        <p className="cl-lead cl-rise" style={{ "--d": 2 } as CSSProperties}>
          {t("companies.landing.hero.lead")}
        </p>
        <div className="cl-ctas cl-rise" style={{ "--d": 3 } as CSSProperties}>
          <Button asChild variant="primary" size="lg">
            <a href="#lista">{t("companies.landing.hero.join")}</a>
          </Button>
          <a className="cl-ghost cl-glass" href="#diferenca">
            {t("companies.landing.hero.compare")}
            <Icon name="arrowDown" size={16} />
          </a>
        </div>
        <p className="cl-note cl-rise" style={{ "--d": 4 } as CSSProperties}>
          <Icon name="lock" size={16} />
          {t("companies.landing.hero.note")}
        </p>
      </div>

      <div className="cl-hero__stage cl-rise" style={{ "--d": 5 } as CSSProperties}>
        <div className="cl-hero__rig">
          <AppWindow />
          {FLOATERS.map((f) => (
            <span
              key={f.key}
              className={`cl-float cl-glass ${f.className}`}
              style={{ "--z": f.z } as CSSProperties}
              aria-hidden="true"
            >
              <BotFace bot={BOTS[f.bot]} guess={32} semBrilho className="cl-float__face" />
              <span className="cl-float__words">
                <span className="cl-float__text">{t(`companies.landing.activity.items.${f.key}` as never)}</span>
                <span className="cl-state" data-state={f.state}>
                  {t(`companies.landing.stage.${f.state}` as never)}
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The hero's picture: the app as a window (the channels and the team on the side, a channel where a person asks
 * the Doug, he splits the work, Rosa delivers and Mark asks for the one approval that matters), read by screen
 * readers as one short description.
 */
function AppWindow() {
  const { t } = useTranslation();
  const k = "companies.landing.chat";
  return (
    <figure className="cl-window cl-glass cl-glass--thick" aria-label={t(`${k}.label` as never)}>
      <div className="cl-window__top" aria-hidden="true">
        <span className="cl-window__lights">
          <span />
          <span />
          <span />
        </span>
        <span className="cl-window__title">
          <Logo size={16} />
        </span>
      </div>
      <div className="cl-window__body" aria-hidden="true">
        <aside className="cl-window__side">
          {(["launch", "money", "support"] as const).map((c, i) => (
            <span key={c} className="cl-window__chan" data-on={i === 0 ? "" : undefined}>
              <Icon name="channel" size={14} />
              {c === "launch" ? t(`${k}.channel` as never) : t(`companies.landing.stage.channels.${c}` as never)}
            </span>
          ))}
          <span className="cl-window__group">{t("companies.landing.stage.team")}</span>
          {(["doug", "rosa", "sony", "mark"] as const).map((b) => (
            <span key={b} className="cl-window__member">
              <BotFace bot={BOTS[b]} guess={20} semBrilho className="cl-window__mini" />
              {NAMES[b]}
              <span className="cl-window__dot" data-bot={b} />
            </span>
          ))}
        </aside>
        <div className="cl-window__main">
          <span className="cl-window__head">
            <Icon name="channel" size={16} />
            {t(`${k}.channel` as never)}
          </span>
          <div className="cl-window__chat">
            <ChatLine face={<Avatar kind="person" name="Ana" size="md" />} name="Ana" text={t(`${k}.ask` as never)} />
            <ChatLine
              face={<BotFace bot={BOTS.doug} guess={36} semBrilho className="cl-msg__bot" />}
              name="Doug"
              text={t(`${k}.plan` as never)}
            />
            <ChatLine
              face={<BotFace bot={BOTS.rosa} guess={36} semBrilho className="cl-msg__bot" />}
              name="Rosa"
              text={t(`${k}.delivered` as never)}
            >
              <span className="cl-files">
                <span />
                <span />
                <span />
              </span>
            </ChatLine>
            <ChatLine
              face={<BotFace bot={BOTS.mark} guess={36} semBrilho className="cl-msg__bot" />}
              name="Mark"
              text={t(`${k}.askApproval` as never)}
            >
              <span className="cl-approval">
                <span className="cl-approval__title">
                  <Icon name="approve" size={16} />
                  {t(`${k}.approval` as never)}
                </span>
                <span className="cl-approval__acts">
                  <span className="cl-approval__btn cl-approval__btn--go">{t(`${k}.approve` as never)}</span>
                  <span className="cl-approval__btn">{t(`${k}.notNow` as never)}</span>
                </span>
              </span>
            </ChatLine>
          </div>
          <span className="cl-window__composer">
            {t("companies.landing.stage.composer")}
            <span className="cl-window__send">
              <Icon name="send" size={14} />
            </span>
          </span>
        </div>
      </div>
    </figure>
  );
}

function ChatLine({
  face,
  name,
  text,
  children,
}: {
  face: ReactNode;
  name: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="cl-msg">
      <span className="cl-msg__face">{face}</span>
      <span className="cl-msg__main">
        <span className="cl-msg__name">{name}</span>
        <span className="cl-msg__text">{text}</span>
        {children}
      </span>
    </div>
  );
}

/** The strip under the hero: what the team is doing, sliding by; it stops under the pointer and with less motion. */
function Activity() {
  const { t } = useTranslation();
  const items = (copy: boolean) => (
    <ul className="cl-strip__list" aria-hidden={copy || undefined}>
      {ACTIVITY.map((a) => (
        <li key={a.key} className="cl-strip__item">
          <BotFace bot={BOTS[a.bot]} guess={24} semBrilho className="cl-strip__face" />
          <span className="cl-strip__text">{t(`companies.landing.activity.items.${a.key}` as never)}</span>
          <span className="cl-state" data-state={a.state}>
            {t(`companies.landing.stage.${a.state}` as never)}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="cl-strip" aria-label={t("companies.landing.activity.label")}>
      <div className="cl-strip__track">
        {items(false)}
        {items(true)}
      </div>
    </section>
  );
}

/** Grok Bot beside DougBot, row by row: the rows come in one after another, the team's side lit. */
function Compare() {
  const { t } = useTranslation();
  const side = (us: boolean) => (
    <div
      className={`cl-versus__col cl-glass ${us ? "cl-versus__col--us cl-glass--thick" : "cl-versus__col--them"}`}
      data-reveal
      style={{ "--d": us ? 1 : 0 } as CSSProperties}
    >
      <span className="cl-versus__name">
        {us ? (
          <>
            <BotFace bot={BOTS.doug} guess={28} semBrilho className="cl-versus__face" />
            DougBot
          </>
        ) : (
          <>
            {t("companies.landing.compare.them")}
            <small>{t("companies.landing.compare.themNote")}</small>
          </>
        )}
      </span>
      <dl className="cl-versus__rows">
        {ROWS.map((row, i) => (
          <div key={row} className="cl-versus__row" data-reveal style={{ "--d": i + (us ? 2 : 1) } as CSSProperties}>
            <dt>{t(`companies.landing.compare.rows.${row}.label` as never)}</dt>
            <dd>
              <Icon name={us ? "check" : "dash"} size={16} />
              {t(`companies.landing.compare.rows.${row}.${us ? "us" : "them"}` as never)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
  return (
    <section className="cl-section" aria-labelledby="cl-diff">
      <SectionHead
        id="cl-diff"
        eyebrow={t("companies.landing.compare.eyebrow")}
        title={t("companies.landing.compare.title")}
        lead={t("companies.landing.compare.lead")}
      />
      <div className="cl-versus">
        {side(false)}
        <span className="cl-versus__vs cl-glass" aria-hidden="true">
          vs
        </span>
        {side(true)}
      </div>
    </section>
  );
}

/** How it works: three steps on a line the scroll draws, each lit as the line reaches it. */
function Steps() {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const frame = useCallback((p: number, el: HTMLElement) => {
    el.style.setProperty("--line", Math.min(1, Math.max(0, (p - 0.2) / 0.4)).toFixed(4));
  }, []);
  useScrollFrame(ref, frame);
  return (
    <section className="cl-section" id="como" aria-labelledby="cl-how" ref={ref}>
      <SectionHead id="cl-how" eyebrow={t("companies.landing.how.eyebrow")} title={t("companies.landing.how.title")} />
      <div className="cl-steps">
        <span className="cl-steps__line" aria-hidden="true">
          <span />
        </span>
        <ol className="cl-steps__list">
          {STEPS.map((s, i) => (
            <li className="cl-step cl-glass" key={s} data-reveal style={{ "--d": i, "--at": i / 2 } as CSSProperties}>
              <span className="cl-step__n" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{t(`companies.landing.how.steps.${s}.title` as never)}</h3>
              <p>{t(`companies.landing.how.steps.${s}.text` as never)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The waiting list's card: glass with a light that follows the pointer. */
function JoinCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointer(ref);
  return (
    <div className="cl-join__card cl-glass cl-glass--thick" ref={ref} data-reveal>
      {children}
    </div>
  );
}

function SectionHead({ id, eyebrow, title, lead }: { id: string; eyebrow: string; title: string; lead?: string }) {
  return (
    <header className="cl-head" data-reveal>
      <p className="cl-eyebrow">{eyebrow}</p>
      <h2 className="cl-h2" id={id}>
        {title}
      </h2>
      {lead && <p className="cl-lead cl-lead--sm">{lead}</p>}
    </header>
  );
}
