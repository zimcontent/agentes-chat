/*
 * The call's own glyphs (ADR doug-0006), drawn like the kit's icons (24 grid, 1.75 stroke, currentColor): a phone handset
 * (the kit's `phone` is a mobile phone), a microphone struck through, and captions.
 */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const HandsetIcon = ({ hangUp }: { hangUp?: boolean }) => (
  <svg aria-hidden="true" {...base} style={hangUp ? { transform: "rotate(135deg)" } : undefined}>
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);

export const MicOffIcon = () => (
  <svg aria-hidden="true" {...base}>
    <path d="M3 3l18 18" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <path d="M12 19v3" />
  </svg>
);

export const CaptionsIcon = () => (
  <svg aria-hidden="true" {...base}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" />
  </svg>
);
