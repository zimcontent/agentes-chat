import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { schema } from "@dougbot/db";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CustomDeps,
  completeOAuth,
  connectCustomServer,
  connectorListing,
  isPasteReturn,
  LOOPBACK_OAUTH_REDIRECT,
  type McpConnect,
  mcpSessionOver,
  pasteReturnPath,
  ValidationError,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * ADR 0130, addendum 2026-11-15: Frame.io's registration takes no web address of ours, only `localhost`. Its sign-in
 * ends on the person's computer and they paste that address; the code is exchanged with the same redirect.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const SERVER = "https://mcp.frame.io/v1/mcp";

/** Frame.io's OAuth as it answered on 2026-11-15: only a loopback redirect registers; a public client, PKCE. */
function frameioAuth() {
  const seen = { redirects: [] as string[][], tokenRedirects: [] as (string | null)[], challenge: "" };
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.toString() === SERVER && method === "POST") {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer error="invalid_token", resource_metadata="https://mcp.frame.io/.well-known/oauth-protected-resource/v1/mcp"',
        },
      });
    }
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return Response.json({
        resource: SERVER,
        authorization_servers: ["https://mcp.frame.io"],
        scopes_supported: ["openid", "AdobeID"],
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: "https://mcp.frame.io",
        authorization_endpoint: "https://mcp.frame.io/authorize",
        token_endpoint: "https://mcp.frame.io/token",
        registration_endpoint: "https://mcp.frame.io/register",
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/register") {
      const body = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
      seen.redirects.push(body.redirect_uris);
      if (!body.redirect_uris.every((u) => u.startsWith("http://127.0.0.1:") || u.startsWith("http://localhost:"))) {
        return Response.json(
          { error: "invalid_redirect_uri", error_description: "One or more redirect URIs are not allowed." },
          { status: 400 },
        );
      }
      return Response.json({ client_id: "fio-client", token_endpoint_auth_method: "none" }, { status: 201 });
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(String(init?.body));
      seen.tokenRedirects.push(form.get("redirect_uri"));
      const pkce = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (pkce !== seen.challenge || form.get("redirect_uri") !== LOOPBACK_OAUTH_REDIRECT) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ access_token: "fio-at", refresh_token: "fio-rt", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { http, seen };
}

/** Frame.io's server once signed in: one read tool. */
const frameioMcp: McpConnect = async () => {
  const server = new McpServer({ name: "frameio", version: "1" });
  server.registerTool(
    "read_comments",
    { description: "Read a file's comments", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: "[]" }] }),
  );
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  return mcpSessionOver(client);
};

const publicDns = async () => ["93.184.216.34"];

const depsOf = (http: typeof fetch): CustomDeps => ({
  db: f.db,
  keyWrappers: [f.keyWrapper],
  publicUrl: "https://chat.example.com",
  resolveHost: publicDns,
  http,
  connect: frameioMcp,
});

test("Frame.io signs in through the person's computer: a loopback redirect, a pasted return, the same redirect for the code", async () => {
  f = await setup();
  const auth = frameioAuth();
  const deps = depsOf(auth.http);
  const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
    serverUrl: SERVER,
    returnTo: "/org/x/settings/connectors",
  });
  expect(started).toMatchObject({ status: "oauth", pasteBack: true });
  if (started.status !== "oauth") throw new Error("expected oauth");
  expect(auth.seen.redirects).toEqual([[LOOPBACK_OAUTH_REDIRECT]]);
  const url = new URL(started.authorizeUrl);
  expect(url.searchParams.get("redirect_uri")).toBe(LOOPBACK_OAUTH_REDIRECT);
  auth.seen.challenge = url.searchParams.get("code_challenge") ?? "";

  const [state] = await f.db.select().from(schema.oauthStates);
  expect(isPasteReturn(state?.returnTo ?? "")).toBe(true);
  expect(pasteReturnPath(state?.returnTo ?? "")).toBe("/org/x/settings/connectors");

  const done = await completeOAuth(
    deps,
    { id: f.owner.id },
    { state: url.searchParams.get("state") ?? "", code: "fio-code" },
  );
  expect(auth.seen.tokenRedirects).toEqual([LOOPBACK_OAUTH_REDIRECT]);
  expect(done.connection.serverUrl).toBe(SERVER);
  expect(done.outcome).toBe("connected");
});

test("Frame.io takes no key: the catalog offers the sign-in only, and a key sent anyway is refused", async () => {
  f = await setup();
  const entry = connectorListing({ oauthApps: {} }).find((e) => e.id === "frameio");
  expect(entry?.auth).toEqual(["oauth"]);
  await expect(
    connectCustomServer(depsOf(frameioAuth().http), f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "some-frameio-token",
    }),
  ).rejects.toBeInstanceOf(ValidationError);
});
