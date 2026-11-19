import { Icon, type IconName } from "@dougbot/ui";
import { sourceMarkOf } from "@dougbot/ui/blocks/source-marks";

/** The app's own sectors take a kit icon; a service its official mark, in its colour. */
const SOURCE_ICONS: Record<string, IconName> = {
  proposals: "bulb",
  approvals: "approve",
  tasks: "issues",
  review: "eye",
  portal: "globe",
  mail: "mail",
  other: "block",
};

export function SourceMark({ service, size = 16 }: { service: string; size?: 14 | 16 | 18 | 20 }) {
  const mark = sourceMarkOf(service);
  if (mark) {
    return (
      <svg
        className="spec-block__source-mark"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={mark.color}
        aria-hidden="true"
      >
        <path d={mark.d} />
      </svg>
    );
  }
  return <Icon name={SOURCE_ICONS[service] ?? "block"} size={size} />;
}
