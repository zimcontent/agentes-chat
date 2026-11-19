import type { Plugin } from "vite";

/*
 * Doug: the stylesheets the first screen loaded before its pieces became lazy (src/components/shell-events.ts), kept in
 * the first paint and in their old order. Lazy, a chunk's stylesheet is appended after the app's own (styles.css, with
 * the theme) and would win its ties: the sidebar's presence ring, for one. src/boot-styles.ts imports them, ahead of
 * styles.css, in the order the old links had (onboarding to install); here any other import of them becomes an empty
 * stylesheet, so each one is bundled once, there.
 */
export const BOOT_STYLES = [
  "pages/onboarding.css",
  "components/workspace-mode.css",
  "components/invite/invite.css",
  "components/devices/devices.css",
  "components/arrival/arrival.css",
  "components/no-ai.css",
  "components/new-agent/new-agent-card.css",
  "components/team-plan.css",
  "components/who-sees.css",
  "components/blocks/blocks.css",
  "components/widgets/widgets.css",
  "components/blocks/spec-block.css",
  "components/missions/missions.css",
  "components/roles/roles.css",
  "components/presence.css",
  "components/install/install.css",
];

const EMPTY = "\0doug-boot-style.css";
const OWNER = "/apps/web/src/boot-styles.ts";

/** Whether an import of `resolved` from `importer` is one of the boot stylesheets imported anywhere but its owner. */
export function redirected(resolved: string, importer: string | undefined): boolean {
  const id = resolved.replaceAll("\\", "/").split("?")[0] ?? "";
  if (importer?.replaceAll("\\", "/").endsWith(OWNER)) return false;
  return BOOT_STYLES.some((file) => id.endsWith(`/apps/web/src/${file}`));
}

export function bootStyles(): Plugin {
  return {
    name: "doug:boot-styles",
    apply: "build",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(".css") || !importer) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved && redirected(resolved.id, importer) ? EMPTY : null;
    },
    load(id) {
      return id === EMPTY ? "" : null;
    },
  };
}
