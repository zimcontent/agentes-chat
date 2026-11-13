import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import DougBot, { type DougBotEstado, type DougBotOpcoes } from "../brand/dougbot-avatar.js";
import { cx } from "../cx";

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * A DougBot drawn by the identity's code (`dougbot-avatar.js`, IDENTIDADE.md §8): SVG in the DOM, never an image.
 * It reads its own size: under 60 px the Doug closes on his face, under 44 px the light on the floor goes out
 * (§7 "Tamanhos"). `guess` is the size before the first measure (the class's), so the first paint is already right.
 */
export function BotFace({
  bot,
  estado = "ok",
  guess = 36,
  titulo,
  semBrilho,
  className,
}: {
  bot: DougBotOpcoes;
  estado?: DougBotEstado;
  guess?: number;
  titulo?: string;
  /** No light on the floor at any size (a light ground, a busy row). */
  semBrilho?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [px, setPx] = useState(guess);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setPx(Math.round(w));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Ids inside the SVG are per drawing: two bots on a page never share a gradient.
  const id = `b${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const svg = useMemo(
    () =>
      DougBot.avatar({
        ...bot,
        estado,
        tamanho: px,
        brilho: !semBrilho && px >= 44,
        id,
        // The name is a person's words: escaped, as everything put in the markup.
        titulo: titulo ? escapeXml(titulo) : undefined,
      })
        .replace(/ width="\d+(\.\d+)?" height="\d+(\.\d+)?"/, "")
        // Who it is is said by the face around it (`Avatar`'s label), once: the drawing itself is decoration.
        .replace(/ role="img" aria-label="[^"]*"><title>[^<]*<\/title>/, ' aria-hidden="true" focusable="false">'),
    [bot, estado, px, semBrilho, id, titulo],
  );
  return (
    <span
      ref={box}
      className={cx("ac-bot", className)}
      data-estado={estado}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the identity's own drawing (fixed shapes and colors); the one word from outside, the title, is escaped
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
