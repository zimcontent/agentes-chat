import { Button, Card, Logo, Textarea } from "@dougbot/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The client's page of the installation's approval portal (docs/adr/doug-0031-embedded-approval-portal.md): a post
 * waiting on them, its video, pictures or carousel with the caption, and "Aprovar" or "Pedir ajuste" (with a note,
 * and on a video a second marked). It works on a phone first, and loads nothing of the app that is signed in: its only
 * data comes from `/p/api/<token>`, read with the link's own token. Its words are the client's own, in pt-BR and
 * English (the browser's), never the workspace's language, since a client has no account here.
 */

type PostStatus =
  | "sent"
  | "seen"
  | "approved"
  | "adjust_requested"
  | "adjusting"
  | "adjusted"
  | "scheduled"
  | "published";

interface Note {
  id: string;
  atSeconds: number | null;
  page: number | null;
  text: string;
  by: string | null;
  at: string;
  kind: "approve" | "adjust" | null;
}
interface Media {
  id: string;
  kind: "video" | "image" | "file";
  name: string;
}
interface Post {
  id: string;
  title: string;
  type: string;
  status: PostStatus;
  caption: string;
  version: number;
  video: boolean;
  media: Media[];
  cover: string | null;
  notes: Note[];
  scheduledFor: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  updatedAt: string;
}
interface PageData {
  client: { client: string; name: string; logo: string | null };
  waiting: Post[];
  history: Post[];
}

type Phase = "loading" | "ready" | "missing" | "failed";
type Locale = "pt-BR" | "en";

const WORDS = {
  "pt-BR": {
    brand: "Aprovações",
    waiting: "Esperando você",
    history: "Histórico",
    loading: "Um instante…",
    missingTitle: "Este link não abre nada",
    missingText: "Ele pode ter sido trocado ou desativado. Peça o link de novo a quem te enviou.",
    failedTitle: "Não conseguimos abrir agora",
    failedText: "Confira a conexão e tente de novo.",
    retry: "Tentar de novo",
    emptyTitle: "Nada para aprovar agora",
    emptyText: "Quando houver uma publicação esperando o seu OK, ela aparece aqui.",
    approve: "Aprovar",
    askChange: "Pedir ajuste",
    changePlaceholder: "O que deve mudar?",
    changeLabel: "O que deve mudar",
    sendChange: "Enviar ajuste",
    cancel: "Cancelar",
    markSecond: "Marcar o segundo",
    markedAt: (at: string) => `Marcado em ${at}.`,
    at: (at: string) => `Em ${at}`,
    clearMark: "Tirar a marca",
    approved: "Aprovado. Obrigado!",
    asked: "Ajuste pedido. A equipe vai cuidar.",
    answered: "Esta publicação já foi respondida.",
    versionChanged: "Saiu uma nova versão desta publicação. Recarregue a página para ver.",
    writeChange: "Escreva o que deve mudar.",
    sendFailed: "Não deu para enviar agora. Tente de novo.",
    connectionFailed: "Não deu para enviar agora. Confira a conexão.",
    post: "Publicação",
    openFile: "Abrir arquivo",
    previousImage: "Anterior",
    nextImage: "Próxima",
    goToImage: (n: number) => `Ir para a imagem ${n}`,
    madeWith: "Feito com DougBot",
    status: {
      sent: "Esperando você",
      seen: "Esperando você",
      adjusted: "Nova versão",
      approved: "Aprovado",
      adjust_requested: "Ajuste pedido",
      adjusting: "Em ajuste",
      scheduled: "Agendado",
      published: "Publicado",
    } as Record<PostStatus, string>,
  },
  en: {
    brand: "Approvals",
    waiting: "Waiting for you",
    history: "History",
    loading: "One moment…",
    missingTitle: "This link doesn't open anything",
    missingText: "It may have been replaced or turned off. Ask whoever sent it for the link again.",
    failedTitle: "We couldn't open it now",
    failedText: "Check your connection and try again.",
    retry: "Try again",
    emptyTitle: "Nothing to approve right now",
    emptyText: "When a post is waiting for your OK, it shows up here.",
    approve: "Approve",
    askChange: "Ask for a change",
    changePlaceholder: "What should change?",
    changeLabel: "What should change",
    sendChange: "Send change",
    cancel: "Cancel",
    markSecond: "Mark the second",
    markedAt: (at: string) => `Marked at ${at}.`,
    at: (at: string) => `At ${at}`,
    clearMark: "Clear the mark",
    approved: "Approved. Thank you!",
    asked: "Change asked. The team will take it.",
    answered: "This post was already answered.",
    versionChanged: "A new version of this post is up. Reload the page to see it.",
    writeChange: "Write what should change.",
    sendFailed: "Couldn't send it now. Try again.",
    connectionFailed: "Couldn't send it now. Check your connection.",
    post: "Post",
    openFile: "Open file",
    previousImage: "Previous",
    nextImage: "Next",
    goToImage: (n: number) => `Go to image ${n}`,
    madeWith: "Made with DougBot",
    status: {
      sent: "Waiting for you",
      seen: "Waiting for you",
      adjusted: "New version",
      approved: "Approved",
      adjust_requested: "Change asked",
      adjusting: "Being changed",
      scheduled: "Scheduled",
      published: "Published",
    } as Record<PostStatus, string>,
  },
};

/** A video's second, as `m:ss`. */
const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** The client's language: the browser's Portuguese, else English (a client has no account to hold a choice). */
function clientLocale(): Locale {
  if (typeof navigator === "undefined") return "pt-BR";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  return tags.some((t) => /^pt\b/i.test(t)) ? "pt-BR" : "en";
}

export function ClientPortalPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<PageData | null>(null);
  const w = WORDS[useMemo(clientLocale, [])];
  const base = `/p/api/${encodeURIComponent(token)}`;
  useEffect(() => {
    document.documentElement.lang = clientLocale();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: { accept: "application/json" }, credentials: "omit" });
      if (res.status === 404) return setPhase("missing");
      if (!res.ok) return setPhase("failed");
      setData((await res.json()) as PageData);
      setPhase("ready");
    } catch {
      setPhase("failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === "loading") {
    return (
      <main className="cportal cportal--message">
        <Logo size={28} />
        <p className="cportal__quiet">{w.loading}</p>
      </main>
    );
  }
  if (phase === "missing") {
    return (
      <main className="cportal cportal--message">
        <Logo size={28} />
        <h1 className="cportal__title">{w.missingTitle}</h1>
        <p className="cportal__quiet">{w.missingText}</p>
      </main>
    );
  }
  if (phase === "failed" || !data) {
    return (
      <main className="cportal cportal--message">
        <Logo size={28} />
        <h1 className="cportal__title">{w.failedTitle}</h1>
        <p className="cportal__quiet">{w.failedText}</p>
        <Button variant="primary" onClick={() => void load()}>
          {w.retry}
        </Button>
      </main>
    );
  }

  return (
    <main className="cportal">
      <header className="cportal__head">
        <span className="cportal__mark" aria-hidden>
          {data.client.logo ? <img src={`${base}/logo`} alt="" /> : <Logo size={28} />}
        </span>
        <div className="cportal__who">
          <p className="cportal__brand">{w.brand}</p>
          <h1 className="cportal__client">{data.client.name}</h1>
        </div>
      </header>
      {data.waiting.length === 0 && data.history.length === 0 ? (
        <Card className="cportal__empty">
          <h2 className="cportal__subtitle">{w.emptyTitle}</h2>
          <p className="cportal__quiet">{w.emptyText}</p>
        </Card>
      ) : (
        <>
          {data.waiting.length > 0 && (
            <section className="cportal__section" aria-label={w.waiting}>
              <h2 className="cportal__heading">{w.waiting}</h2>
              {data.waiting.map((post) => (
                <PostCard key={post.id} post={post} base={base} onChanged={load} words={w} waiting />
              ))}
            </section>
          )}
          {data.history.length > 0 && (
            <section className="cportal__section" aria-label={w.history}>
              <h2 className="cportal__heading">{w.history}</h2>
              {data.history.map((post) => (
                <PostCard key={post.id} post={post} base={base} onChanged={load} words={w} />
              ))}
            </section>
          )}
        </>
      )}
      <footer className="cportal__foot">
        <Logo size={18} mono />
        <span>{w.madeWith}</span>
      </footer>
    </main>
  );
}

type Words = (typeof WORDS)["pt-BR"];

function PostCard({
  post,
  base,
  onChanged,
  words: w,
  waiting = false,
}: {
  post: Post;
  base: string;
  onChanged: () => Promise<void>;
  words: Words;
  waiting?: boolean;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "approve" | "adjust">(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // A video's marked second: taken from the player where it stands, and shown back as a chip.
  const [mark, setMark] = useState<number | null>(null);
  const page = useCarouselPage(post.media.filter((m) => m.kind !== "video").length);

  const file = (id: string) => `${base}/files/${encodeURIComponent(id)}`;
  const images = post.media.filter((m) => m.kind === "image");
  const videos = post.media.filter((m) => m.kind === "video");

  const decide = async (decision: "approve" | "adjust") => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${base}/decide`, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          postId: post.id,
          decision,
          // The version this card shows: the server refuses a decision on one that moved on meanwhile.
          version: post.version,
          text: decision === "adjust" ? note.trim() : undefined,
          atSeconds: decision === "adjust" && mark !== null ? mark : undefined,
          page: decision === "adjust" && page.current !== null && images.length > 1 ? page.current + 1 : undefined,
        }),
      });
      if (res.status === 409) {
        // A version that moved on since this card was drawn: the page asks for a reload, and the decision waits.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (body?.error?.code === "portal.version_changed") {
          setError(w.versionChanged);
          await onChanged();
          return;
        }
        setError(w.answered);
        return;
      }
      if (!res.ok) {
        setError(decision === "adjust" && !note.trim() ? w.writeChange : w.sendFailed);
        return;
      }
      setDone(decision);
      await onChanged();
    } catch {
      setError(w.connectionFailed);
    } finally {
      setSending(false);
    }
  };

  const takeMark = () => {
    const at = videoRef.current?.currentTime ?? 0;
    setMark(Math.round(at));
    if (!adjusting) setAdjusting(true);
  };

  return (
    <Card className={`cportal__post${waiting ? " cportal__post--waiting" : ""}`}>
      <div className="cportal__media">
        {videos.length === 1 ? (
          <VideoMedia
            src={file((videos[0] as Media).id)}
            cover={post.cover ? file(post.cover) : null}
            videoRef={videoRef}
            onMark={waiting ? takeMark : undefined}
            label={w.markSecond}
          />
        ) : images.length > 0 ? (
          <Carousel
            images={images.map((m) => ({ id: m.id, src: file(m.id) }))}
            page={page}
            previous={w.previousImage}
            next={w.nextImage}
            goTo={w.goToImage}
          />
        ) : post.media.length > 0 ? (
          <a className="cportal__file" href={file((post.media[0] as Media).id)} target="_blank" rel="noreferrer">
            {w.openFile}
          </a>
        ) : null}
        <span className="cportal__badge">{w.status[post.status]}</span>
        {post.version > 1 && <span className="cportal__version">V{post.version}</span>}
      </div>
      <div className="cportal__body">
        <h3 className="cportal__post-title">{post.title || w.post}</h3>
        {post.caption && <p className="cportal__caption">{post.caption}</p>}
        {post.notes.length > 0 && (
          <ul className="cportal__notes">
            {post.notes.map((n) => (
              <li key={n.id} className="cportal__note">
                {n.atSeconds !== null && <span className="cportal__note-mark">{clock(n.atSeconds)}</span>}
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        )}
        {waiting && done === null && (
          <div className="cportal__actions">
            {!adjusting ? (
              <>
                <Button variant="primary" size="lg" block loading={sending} onClick={() => void decide("approve")}>
                  {w.approve}
                </Button>
                <Button size="lg" block onClick={() => setAdjusting(true)} disabled={sending}>
                  {w.askChange}
                </Button>
                {mark !== null && <p className="cportal__mark-hint">{w.markedAt(clock(mark))}</p>}
              </>
            ) : (
              <div className="cportal__adjust">
                {mark !== null && (
                  <span className="cportal__note-mark cportal__note-mark--chip">
                    {w.at(clock(mark))}
                    <button type="button" onClick={() => setMark(null)} aria-label={w.clearMark}>
                      ×
                    </button>
                  </span>
                )}
                <Textarea
                  aria-label={w.changeLabel}
                  placeholder={w.changePlaceholder}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="cportal__adjust-actions">
                  <Button variant="ghost" onClick={() => setAdjusting(false)} disabled={sending}>
                    {w.cancel}
                  </Button>
                  <Button
                    variant="primary"
                    loading={sending}
                    onClick={() => void decide("adjust")}
                    disabled={!note.trim()}
                  >
                    {w.sendChange}
                  </Button>
                </div>
              </div>
            )}
            {error && <p className="cportal__error">{error}</p>}
          </div>
        )}
        {done !== null && <p className="cportal__thanks">{done === "approve" ? w.approved : w.asked}</p>}
      </div>
    </Card>
  );
}

/** A carousel of pictures on a phone: swipe by pointer, arrows on a wide screen, dots under it. */
function Carousel({
  images,
  page,
  previous,
  next,
  goTo,
}: {
  images: { id: string; src: string }[];
  page: ReturnType<typeof useCarouselPage>;
  previous: string;
  next: string;
  goTo: (n: number) => string;
}) {
  const { current, set, prev, next: forward } = page;
  return (
    <div className="cportal__carousel">
      <div className="cportal__strip" style={{ transform: `translateX(calc(-100% * ${current}))` }}>
        {images.map((img) => (
          <img key={img.id} className="cportal__pic" src={img.src} alt="" loading="lazy" />
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button type="button" className="cportal__arrow cportal__arrow--prev" onClick={prev} aria-label={previous}>
            ‹
          </button>
          <button type="button" className="cportal__arrow cportal__arrow--next" onClick={forward} aria-label={next}>
            ›
          </button>
          <div className="cportal__dots" role="tablist">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                role="tab"
                aria-selected={i === current}
                aria-label={goTo(i + 1)}
                className={`cportal__dot${i === current ? " is-on" : ""}`}
                onClick={() => set(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function useCarouselPage(count: number) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    setCurrent((c) => Math.min(c, Math.max(0, count - 1)));
  }, [count]);
  const set = useCallback((i: number) => setCurrent(() => Math.max(0, Math.min(count - 1, i))), [count]);
  const prev = useCallback(() => setCurrent((c) => Math.max(0, c - 1)), []);
  const next = useCallback(() => setCurrent((c) => Math.min(Math.max(0, count - 1), c + 1)), [count]);
  return useMemo(() => ({ current, set, prev, next }), [current, set, prev, next]);
}

function VideoMedia({
  src,
  cover,
  videoRef,
  onMark,
  label,
}: {
  src: string;
  cover: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onMark?: () => void;
  label: string;
}) {
  return (
    <div className="cportal__video-wrap">
      {/* biome-ignore lint/a11y/useMediaCaption: the client's own video has no captions to offer; the team's files arrive as they are */}
      <video
        ref={videoRef}
        className="cportal__video"
        src={src}
        poster={cover ?? undefined}
        controls
        playsInline
        preload="metadata"
      />
      {onMark && (
        <button type="button" className="cportal__mark-btn" onClick={onMark}>
          {label}
        </button>
      )}
    </div>
  );
}
