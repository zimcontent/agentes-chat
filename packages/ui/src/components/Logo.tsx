import type { CSSProperties, HTMLAttributes } from "react";
import { brandName } from "../brand/doug";
import type { DougBotEstado } from "../brand/dougbot-avatar.js";
import { cx } from "../cx";
import { BotFace } from "./BotFace";

const DOUG = { bot: "doug" } as const;

/**
 * The Doug close up (IDENTIDADE.md §2–3): the product's mark, drawn by the identity's code, never an image. No light
 * on the floor: it sits beside words.
 */
export function DougMark({
  size,
  className,
  label,
  style,
  estado,
  ...rest
}: {
  size?: number;
  className?: string;
  label?: string;
  /** His state (§2): at work while something loads. */
  estado?: DougBotEstado;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  const shared = {
    ...rest,
    className: cx("ac-logo__mark", className),
    style: size ? { width: size, height: size, ...style } : style,
  };
  const face = <BotFace bot={DOUG} estado={estado} guess={size ?? 32} semBrilho />;
  return label ? (
    <span {...shared} role="img" aria-label={label}>
      {face}
    </span>
  ) : (
    <span {...shared} aria-hidden="true">
      {face}
    </span>
  );
}

/** The product's mark wherever the app showed its own (kept as `LogoMark` so every caller follows the brand). */
export const LogoMark = DougMark;

export interface LogoProps {
  /** Kept for callers: both variants show the signature. */
  variant?: "main" | "expanded";
  /** One-color version. */
  mono?: boolean;
  /** The name's size in px; the Doug is 1.42 times it, 0.36 of it away (IDENTIDADE.md §3). */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * A name in the signature's two weights: the first word 800 and the rest 500 ("Doug" + "Bot"), the way the identity
 * draws it. A client's name (ADR doug-0020) keeps that split at its first space, so "Padaria Aurora" reads "Padaria"
 * 800 + "Aurora" 500.
 */
const SignatureName = ({ name }: { name: string }) => {
  const at = name.indexOf(" ");
  return at < 0 ? (
    <b>{name}</b>
  ) : (
    <>
      <b>{name.slice(0, at)}</b>
      {name.slice(at)}
    </>
  );
};

/**
 * The signature (IDENTIDADE.md §3): the Doug close up and the name, side by side, live text in Manrope ("Doug" 800,
 * "Bot" 500, one color). No box, no seal, no shadow. Its accessible name is the brand's: the client's, on a server
 * deployed for one (ADR doug-0020).
 */
export function Logo({ mono, size = 22, className, style }: LogoProps) {
  const name = brandName();
  return (
    <span
      className={cx("ac-logo", "db-assina", mono && "ac-logo--mono", className)}
      style={{ "--t": `${size}px`, ...style } as CSSProperties}
      role="img"
      aria-label={name}
    >
      <DougMark />
      <span className="ac-logo__word" aria-hidden="true">
        <SignatureName name={name} />
      </span>
    </span>
  );
}
