import type { Config } from "@dougbot/config";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";

/**
 * Links to the website that open the phone app when it is installed (iOS universal links, Android App Links): an
 * invitation, "Esqueci a senha", an early-access sign-up, and a workspace's pages the app has a screen for (a
 * conversation and its message `?m=`, a DM, a thread, an agent, tasks, routines, approvals, the inbox, search, Drive,
 * the wiki, people, the task manager, the settings sections the app has). Without the app they stay links to the
 * website. The files
 * below are what iOS and Android fetch from our domain to trust the app with those paths.
 *
 * iOS reads the paths from here (`*` is any text); Android from the app's build (`APP_LINK_PATTERNS` in
 * apps/mobile/app.config.ts, kept equal by a test). The app maps each one to its screen
 * (apps/mobile/src/features/links/app-links.ts). The API, sign-in callbacks, billing and the pages the app lacks
 * (calendar, team, the settings sections not listed) are left out: they open the website.
 */
export const APP_LINK_PATHS = [
  "/invite/*",
  "/reset-password",
  "/signup",
  "/org/*/home",
  "/org/*/dashboards",
  "/org/*/dashboards/*",
  "/org/*/review",
  "/org/*/review/*",
  "/org/*/c/*",
  "/org/*/dm/*",
  "/org/*/threads",
  "/org/*/threads/*",
  "/org/*/agents/*",
  "/org/*/approvals",
  "/org/*/proposals",
  "/org/*/task-manager",
  "/org/*/notifications",
  "/org/*/issues",
  "/org/*/issues/*",
  "/org/*/routines",
  "/org/*/search",
  "/org/*/drive",
  "/org/*/wiki",
  "/org/*/wiki/*",
  "/org/*/members",
  "/org/*/settings",
  "/org/*/settings/account",
  "/org/*/settings/notifications",
  "/org/*/settings/apps",
  "/org/*/settings/general",
  "/org/*/settings/members",
  "/org/*/settings/invites",
  "/org/*/settings/audit",
  "/org/*/settings/access",
  "/org/*/settings/connectors",
  "/org/*/settings/skills",
  "/org/*/settings/keys",
  "/org/*/settings/storage",
  "/org/*/settings/computers",
  "/org/*/settings/devices",
  "/org/*/settings/usage",
  "/org/*/settings/import",
  "/org/*/settings/media",
  "/org/*/settings/approvals",
  "/org/*/settings/right_hand",
  "/org/*/settings/roles",
  "/org/*/settings/vault",
  "/org/*/settings/about",
  "/org/*/settings/computers/*",
  "/org/*/settings/devices/*",
];

/**
 * A settings address carrying a sign-in's result or an action only the website runs (`?mail=`, `?connected=`…, read by
 * apps/web/src/routes/org.$orgId.settings_.$section.tsx): iOS leaves it to the website. Android can't match a query,
 * so the app sends those to the browser itself (`WEB_ONLY_QUERIES` in apps/mobile/src/features/links/app-links.ts,
 * kept equal by a test).
 */
export const APP_LINK_WEB_QUERIES = ["mail", "connected", "outcome", "review", "install", "delete"];

/** A comma-separated variable's entries (several apps: the store's and its preview or development builds). */
export const listOf = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * DougBot (this fork's phone app, apps/mobile/app.config.ts): the store build and its preview and development builds.
 * Used when the server's own variables leave the app unnamed (unset, not blank), so a DougBot server trusts the DougBot
 * app with its links once `APPLE_TEAM_ID` (and, on Android, `ANDROID_APP_CERT_SHA256`) is set.
 */
export const DOUGBOT_APP_IDS = ["app.dougbot", "app.dougbot.preview", "app.dougbot.development"];

/** Where this server publishes its OAuth client metadata document. */
export const CIMD_PATH = "/oauth/client-metadata.json";

/** `apple-app-site-association`: the iOS apps (team + bundle ids) handle these paths. Null when not configured. */
export function appleAppSiteAssociation(config: Pick<Config, "APPLE_TEAM_ID" | "APPLE_APP_BUNDLE_ID">) {
  const bundles = config.APPLE_APP_BUNDLE_ID === undefined ? DOUGBOT_APP_IDS : listOf(config.APPLE_APP_BUNDLE_ID);
  if (!config.APPLE_TEAM_ID || bundles.length === 0) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: bundles.map((bundle) => `${config.APPLE_TEAM_ID}.${bundle}`),
          // Apple takes the first component that matches: the exclusions go first.
          components: [
            ...APP_LINK_WEB_QUERIES.map((key) => ({ "/": "/org/*/settings/*", "?": { [key]: "*" }, exclude: true })),
            ...APP_LINK_PATHS.map((path) => ({ "/": path })),
          ],
        },
      ],
    },
  };
}

/** `assetlinks.json`: the Android apps (packages + signing certificates) handle our links. Null when not configured. */
export function androidAssetLinks(config: Pick<Config, "ANDROID_APP_PACKAGE" | "ANDROID_APP_CERT_SHA256">) {
  const fingerprints = listOf(config.ANDROID_APP_CERT_SHA256).map((f) => f.toUpperCase());
  const packages = config.ANDROID_APP_PACKAGE === undefined ? DOUGBOT_APP_IDS : listOf(config.ANDROID_APP_PACKAGE);
  if (packages.length === 0 || fingerprints.length === 0) return null;
  return packages.map((name) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: name, sha256_cert_fingerprints: fingerprints },
  }));
}

/**
 * Serves both files as JSON with no redirect, as both platforms require: Apple's at `/.well-known/` and at the root
 * (where older iOS versions look).
 */
export function registerAppLinks(app: OpenAPIHono, config: Config) {
  const apple = (c: Context) => {
    const body = appleAppSiteAssociation(config);
    return body ? c.json(body) : c.text("Not found", 404);
  };
  app.get("/.well-known/apple-app-site-association", apple);
  app.get("/apple-app-site-association", apple);
  // OAuth Client ID Metadata Document: our client to servers that take one instead of a registration
  // (`MCP_CIMD_ISSUERS`, packages/engine connectors/oauth-mcp.ts); its address is the client_id.
  app.get(CIMD_PATH, (c) => {
    const origin = new URL(config.PUBLIC_URL).origin;
    return c.json({
      client_id: `${origin}${CIMD_PATH}`,
      client_name: "DougBot",
      client_uri: origin,
      redirect_uris: [`${origin}/api/app/connectors/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
  app.get("/.well-known/assetlinks.json", (c) => {
    const body = androidAssetLinks(config);
    return body ? c.json(body) : c.text("Not found", 404);
  });
}
