import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AgentesModule } from "./index";

/**
 * A client's customizations (ADR doug-0020): two files in a folder of three digits under `clients/` at the root of
 * the source, `config.json` (what the apps show and what this client turns on or off) and `client.ts` (an
 * `AgentesModule`, for anything a module can do). The server loads the folder of its `DOUG_CLIENT_CODE` at boot and
 * nothing without one, so every server built from this source behaves the same until a client names it.
 *
 * A folder never changes what the product does for everyone: it may only add through the module API and rename or
 * switch off for itself, in the shape `config.json` declares here. What turns out to be good for every client moves
 * out of `clients/` into the shared code (ADR doug-0020 §4).
 */

/** Three digits, such as `064`: the value of `DOUG_CLIENT_CODE` and the start of its folder's name (ADR doug-0020). */
export const CLIENT_CODE = /^\d{3}$/;

/** A folder a code names: the code alone (`064`) or the code and a slug (`064-padaria-aurora`), the deploy's own shape. */
const CLIENT_FOLDER = /^(\d{3})(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/** The one folder under `root` whose name starts with `code`, or null: the code alone, or the code and its slug. */
function folderOf(root: string, code: string): string | null {
  if (!existsSync(root)) return null;
  const found = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CLIENT_FOLDER.exec(entry.name)?.[1] === code)
    .map((entry) => entry.name)
    .sort();
  if (found.length > 1) {
    throw new ClientConfigError(
      `clients/ has more than one folder for ${code} (${found.join(", ")}): a code names one client`,
    );
  }
  return found[0] ? resolve(root, found[0]) : null;
}

/** A color the apps may paint: `#rrggbb`. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** `config.json`: every override a client may declare. Strict: a misspelled key is a boot error, never a silent no-op. */
export const clientConfigSchema = z
  .object({
    /**
     * What the apps call this workspace and the color they highlight (ADR doug-0020 §3). Both optional: without them
     * the apps say the build's own name and paint its own green.
     */
    product: z
      .object({
        /** Shown where the apps sign the product (the signature and the tab's title). A line, at most 40 characters. */
        name: z.string().trim().min(1).max(40).optional(),
        /** The highlight's color: `#rrggbb`, as an admin would pick it. */
        accent: z.string().regex(HEX, "must be a color such as #C2410C").optional(),
      })
      .strict()
      .optional(),
    /**
     * The tools of the sidebar this client turns off for every workspace on its server, by the id the apps know
     * (`media`, `whatsapp`, `review`, `portal`, `wiki`, `drive`, `routines`, `calendar`, `dashboards`, `team`,
     * `issues`, `taskManager`): `false` takes one out, `true` is the default and changes nothing. An id the product
     * doesn't know is ignored, as a workspace's own settings ignore one.
     */
    features: z.record(z.string().min(1).max(40), z.boolean()).optional(),
    /**
     * Handles of the agents this client leaves out of the apps' lists (`otto`, `rui`), for a client whose team is a
     * subset of the ones the products ships. The right hand is never hidden: it is part of the workspace.
     */
    teamAgentsHidden: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
    /** What the onboarding says on top of its rail, in the client's own words. */
    onboarding: z
      .object({
        /** A line or two greeting whoever sets the workspace up. At most 240 characters. */
        intro: z.string().trim().min(1).max(240).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ClientConfig = z.infer<typeof clientConfigSchema>;

/** A client folder as the server read it: its code, where it is, what it declares and its module (null: only config). */
export interface LoadedClient {
  code: string;
  dir: string;
  config: ClientConfig;
  module: AgentesModule | null;
}

/** A client folder that can't be used, with what to fix: thrown at boot, before anything serves. */
export class ClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientConfigError";
  }
}

/** The `clients/` folder this build carries, walking up from this module (a bundle may sit a few levels deeper). */
export function clientsRoot(from: string = import.meta.dir): string | null {
  let dir = resolve(from);
  for (let up = 0; up < 6; up++) {
    if (existsSync(resolve(dir, "clients"))) return resolve(dir, "clients");
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** A module as `client.ts` exports it: a named module with `onStart` and the rest as functions when present. */
function isModule(value: unknown): value is AgentesModule {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim()) return false;
  return ["adapters", "registerRoutes", "onStart", "onStop"].every(
    (key) => m[key] === undefined || typeof m[key] === "function",
  );
}

const readJson = async (path: string): Promise<unknown> => {
  try {
    return await Bun.file(path).json();
  } catch (error) {
    throw new ClientConfigError(`${path} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * The client `code` names, read from `root` (default: this build's `clients/`), or null without a code. A code with
 * no folder, a folder with neither file, a `config.json` off the schema or a `client.ts` that exports no module is a
 * `ClientConfigError`, never a server that boots as if nothing had been asked for it.
 */
export async function loadClient(code: string | undefined, root?: string | null): Promise<LoadedClient | null> {
  const wanted = code?.trim();
  if (!wanted) return null;
  if (!CLIENT_CODE.test(wanted))
    throw new ClientConfigError(`DOUG_CLIENT_CODE must be three digits, such as 064: "${wanted}"`);
  const base = root === undefined ? clientsRoot() : root;
  if (!base) {
    throw new ClientConfigError(
      `DOUG_CLIENT_CODE is ${wanted} but this build carries no clients/ folder: a native package or a bundle made without one can't load a client`,
    );
  }
  const dir = folderOf(base, wanted);
  if (!dir) {
    throw new ClientConfigError(
      `DOUG_CLIENT_CODE is ${wanted} but ${base} has no folder for it (clients/${wanted}/ or clients/${wanted}-<slug>/): add the client's folder, or unset the variable`,
    );
  }
  const configPath = resolve(dir, "config.json");
  const modulePath = resolve(dir, "client.ts");
  const hasConfig = existsSync(configPath);
  const hasModule = existsSync(modulePath);
  if (!hasConfig && !hasModule) {
    throw new ClientConfigError(
      `${dir} has neither config.json nor client.ts: a client folder needs at least one of them`,
    );
  }
  let config: ClientConfig = {};
  if (hasConfig) {
    const parsed = clientConfigSchema.safeParse(await readJson(configPath));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      throw new ClientConfigError(
        `${configPath} isn't a client's config:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
      );
    }
    config = parsed.data;
  }
  let module: AgentesModule | null = null;
  if (hasModule) {
    let loaded: unknown;
    try {
      loaded = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      throw new ClientConfigError(
        `${modulePath} didn't load: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const exported = (loaded as { default?: unknown }).default;
    if (!isModule(exported))
      throw new ClientConfigError(`${modulePath} must export default an AgentesModule (a name, and functions)`);
    module = exported;
  }
  return { code: wanted, dir, config, module };
}

/**
 * What `config.json` gives the apps, as the server holds it: the name and color to show, the tools this client turns
 * off, the agents it leaves out and the onboarding's own words. Absent client: no overrides at all.
 */
export interface ClientOverrides {
  /** The code, for logs and `/api/health`. */
  code: string;
  /** Shown instead of the build's name; null: the apps say their own. */
  name: string | null;
  /** The highlight's color; null: the apps paint their own. */
  accent: string | null;
  /** The tools this client turns off for every workspace (`features`' `false` entries, in the config's order). */
  hiddenTools: string[];
  /** Handles of the agents its apps leave out of their lists (never the right hand, which the apps always keep). */
  hiddenAgents: string[];
  /** What the onboarding says on top of its rail; null: nothing extra. */
  onboardingIntro: string | null;
}

export function overridesOf(client: LoadedClient): ClientOverrides {
  const { product, features, teamAgentsHidden, onboarding } = client.config;
  return {
    code: client.code,
    name: product?.name ?? null,
    accent: product?.accent ?? null,
    hiddenTools: Object.entries(features ?? {})
      .filter(([, on]) => !on)
      .map(([id]) => id),
    hiddenAgents: [...new Set((teamAgentsHidden ?? []).map((h) => h.replace(/^@/, "").toLowerCase()))],
    onboardingIntro: onboarding?.intro ?? null,
  };
}
