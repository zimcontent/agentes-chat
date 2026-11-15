/**
 * A sign-in that ends on the person's own computer (Frame.io takes no other redirect, ADR 0130 addendum 2026-11-15):
 * the browser lands on a `127.0.0.1` page that doesn't open, and the person pastes its address in the connect
 * dialog. This reads what they pasted: the whole address, or just its query, with or without spaces around it.
 *
 * `null`: nothing that looks like that page's address (the dialog asks again). `error`: the vendor refused or the
 * person cancelled there.
 */
export function pastedOAuthReturn(text: string): { state: string; code: string } | { error: string } | null {
  const value = text.trim();
  if (!value) return null;
  let params: URLSearchParams;
  try {
    params = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? new URL(value).searchParams
      : new URLSearchParams(value.slice(value.indexOf("?") + 1));
  } catch {
    return null;
  }
  const error = params.get("error");
  if (error) return { error };
  const state = params.get("state")?.trim();
  const code = params.get("code")?.trim();
  // Frame.io's codes are sealed tokens of a few thousand characters; the route takes up to 8192.
  if (!state || !code || state.length > 200 || code.length > 8192) return null;
  return { state, code };
}
