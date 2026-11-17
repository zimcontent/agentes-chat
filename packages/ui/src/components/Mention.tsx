import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mentionTone } from "../agent/engine.js";
import { cx } from "../cx";
import type { AgentColor } from "./AgentLook";

/**
 * An @mention. `tone` tints it in both themes: a mentioned agent's color, or a person's role's. `face` leads it, at the
 * text's size (an agent's bot, a person's photo or initials), so a name reads as who it is; a person with no role color keeps a
 * neutral plate that still stands out from the words (`ac-mention--person`).
 */
export function Mention({
  tone,
  face,
  person,
  className,
  style,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: AgentColor | undefined;
  /** A small face before the name (`Avatar size="xs"`, an agent's or a person's). Out of the copied text and of the accessible name. */
  face?: ReactNode;
  /** A workspace member: the visible plate even without a tone. */
  person?: boolean;
}) {
  const vars = tone ? toneVars(tone) : undefined;
  return (
    <span
      className={cx(
        "ac-mention",
        tone && "ac-mention--toned",
        person && "ac-mention--person",
        face != null && "ac-mention--face",
        className,
      )}
      style={vars ? { ...vars, ...style } : style}
      {...rest}
    >
      {face ? (
        <>
          <span className="ac-mention__face" aria-hidden="true">
            {face}
          </span>
          <span className="ac-mention__name">{children}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}

function toneVars(tone: AgentColor): CSSProperties {
  const light = mentionTone(tone);
  const dark = mentionTone(tone, true);
  return {
    "--mention-bg": light.background,
    "--mention-ink": light.ink,
    "--mention-bg-dark": dark.background,
    "--mention-ink-dark": dark.ink,
  } as CSSProperties;
}
