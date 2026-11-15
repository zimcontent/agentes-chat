/**
 * Where a connector's OAuth round trip lands. The web app: a path on our site (the callback finishes with the
 * browser's session). The phone app and the desktop app's window: the system browser has no session of ours, so
 * the callback hands the code and state back to the app through its deep link, and the app finishes with its own
 * session (`POST …/connectors/oauth/complete`): the state is still bound to the person who started it, so a code
 * caught by anyone else can't be used.
 */

/** Stored as the state's `returnTo` when the phone app started the authorization. */
export const APP_OAUTH_RETURN = "app:connectors";

/** The phone app's deep link (its scheme in apps/mobile/app.config.ts) that receives `state` and `code`. */
export const APP_OAUTH_REDIRECT = "agenteschat://connectors/oauth";

/**
 * The start of the state's `returnTo` when the desktop app's window started the authorization (ADR 0036): the
 * path on our site to land on follows (`desktop:/org/…/settings/connectors`).
 */
export const DESKTOP_OAUTH_RETURN = "desktop:";

/**
 * The desktop app's deep link (its scheme in apps/desktop tauri.conf.json, read by deep_link.rs) that receives
 * `org`, `state` and `code`: the app opens them in its window, which finishes with the window's session.
 */
// DougBot: only the desktop app reads this link, so it carries the app's own scheme (it answers to both).
export const DESKTOP_OAUTH_REDIRECT = "dougbot://desktop/connectors/oauth";

const sitePath = (input: string | undefined): input is string =>
  Boolean(input?.startsWith("/") && !input.startsWith("//") && !input.startsWith("/\\"));

/** A safe `returnTo`: an app's marker, or a path on our site (never another host); "/" otherwise. */
export function oauthReturnTo(input: string | undefined): string {
  if (input === APP_OAUTH_RETURN) return APP_OAUTH_RETURN;
  if (input?.startsWith(DESKTOP_OAUTH_RETURN)) {
    const path = input.slice(DESKTOP_OAUTH_RETURN.length);
    return DESKTOP_OAUTH_RETURN + (sitePath(path) ? path : "/");
  }
  return sitePath(input) ? input : "/";
}

/**
 * Where a vendor that accepts no web address of ours sends its sign-in back (ADR 0130, addendum 2026-11-15): the
 * person's own computer, where nothing listens. Frame.io registers only `localhost` and the addresses of the clients
 * Adobe approved; its page then fails to open, and the person pastes its address into the connect dialog, which
 * finishes with their session (`POST …/connectors/oauth/complete`). The state stays bound to that person, and PKCE to
 * this server, so an address seen by anyone else can't be used.
 */
export const LOOPBACK_OAUTH_REDIRECT = "http://127.0.0.1:33418/dougbot/connectors/oauth";

/** The start of the state's `returnTo` when the person pastes the return address back: the path to land on follows. */
export const PASTE_OAUTH_RETURN = "paste:";

/** The authorization comes back by a pasted address. */
export const isPasteReturn = (returnTo: string) => returnTo.startsWith(PASTE_OAUTH_RETURN);

/** The path on our site a pasted authorization lands on once finished. */
export const pasteReturnPath = (returnTo: string) => returnTo.slice(PASTE_OAUTH_RETURN.length) || "/";

/** A `returnTo` for a pasted return: the path the dialog was opened from (an app's marker lands at the root). */
export function pasteReturnTo(input: string | undefined): string {
  const returnTo = oauthReturnTo(input);
  const path = isDesktopReturn(returnTo) ? desktopReturnPath(returnTo) : isAppReturn(returnTo) ? "/" : returnTo;
  return PASTE_OAUTH_RETURN + path;
}

/** The authorization was started by the phone app. */
export const isAppReturn = (returnTo: string) => returnTo === APP_OAUTH_RETURN;

/** The authorization was started by the desktop app's window. */
export const isDesktopReturn = (returnTo: string) => returnTo.startsWith(DESKTOP_OAUTH_RETURN);

/** The path on our site a desktop authorization lands on once finished. */
export const desktopReturnPath = (returnTo: string) => returnTo.slice(DESKTOP_OAUTH_RETURN.length) || "/";

/**
 * The app's deep link with what the provider sent back (or why it refused). GitHub's return from installing the
 * GitHub App adds its `installation_id` (the app finishes with `…/github-app/complete`).
 */
export function appOAuthRedirect(input: { state?: string; code?: string; error?: string; installationId?: number }) {
  const url = new URL(withParams(APP_OAUTH_REDIRECT, input));
  if (input.installationId) url.searchParams.set("installation_id", String(input.installationId));
  return url.toString();
}

/** The desktop app's deep link with the organization and what the provider sent back (or why it refused). */
export function desktopOAuthRedirect(input: { org: string; state?: string; code?: string; error?: string }): string {
  return withParams(DESKTOP_OAUTH_REDIRECT, input);
}

/**
 * A mailbox's return from Composio (mail accounts.ts) rides the same link. The callback has read the account
 * already, so the link only says how it went: `state=mail` and `code=connected|failed`, in the fields the apps
 * pass on (deep_link.rs). apps/web DesktopConnectorPage.tsx reads it.
 */
export const DESKTOP_MAIL_STATE = "mail";

/** The desktop app's deep link after a mailbox's return; no organization when the mailbox wasn't found. */
export const desktopMailRedirect = (org: string | undefined, ok: boolean) =>
  desktopOAuthRedirect({ org: org ?? "", state: DESKTOP_MAIL_STATE, code: ok ? "connected" : "failed" });

function withParams(link: string, input: { org?: string; state?: string; code?: string; error?: string }) {
  const url = new URL(link);
  if (input.org) url.searchParams.set("org", input.org);
  if (input.error) url.searchParams.set("error", input.error);
  if (input.state) url.searchParams.set("state", input.state);
  if (input.code) url.searchParams.set("code", input.code);
  return url.toString();
}
