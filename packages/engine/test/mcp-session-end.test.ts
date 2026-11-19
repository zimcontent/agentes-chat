import { describe, expect, test } from "bun:test";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcpSessionOver } from "../src";

const SERVER = "https://bridge.example.com/mcp";
const SESSION = "5e55-10n";

/**
 * A stateful MCP server over HTTP (no network), like a stdio bridge that holds a process (or an SSH connection) per
 * session until the session is ended. `hangOnEnd`: it never answers the DELETE.
 */
function statefulServer(opts: { hangOnEnd?: boolean } = {}) {
  const ended: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method === "DELETE") {
      ended.push(headers.get("mcp-session-id") ?? "");
      if (opts.hangOnEnd) return new Promise<Response>(() => {});
      return new Response(null, { status: 200 });
    }
    if (method !== "POST") return new Response(null, { status: 405 });
    const msg = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (msg.id === undefined) return new Response(null, { status: 202 });
    const result =
      msg.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "bridge", version: "1" } }
        : { tools: [{ name: "buscar_contexto", inputSchema: { type: "object" } }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), {
      headers: { "content-type": "application/json", "mcp-session-id": SESSION },
    });
  };
  return { fetch, ended };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("closing an MCP session", () => {
  test("ends it on the server, so a bridge lets go of what it holds for it", async () => {
    const server = statefulServer();
    const session = await mcpSessionOver(new StreamableHTTPClientTransport(new URL(SERVER), { fetch: server.fetch }));
    expect((await session.listTools()).map((t) => t.name)).toEqual(["buscar_contexto"]);
    await session.close();
    await settle();
    expect(server.ended).toEqual([SESSION]);
  });

  test("a server that never answers the end holds nobody", async () => {
    const server = statefulServer({ hangOnEnd: true });
    const session = await mcpSessionOver(new StreamableHTTPClientTransport(new URL(SERVER), { fetch: server.fetch }));
    await session.listTools();
    const at = performance.now();
    await session.close();
    expect(performance.now() - at).toBeLessThan(100);
    await settle();
    expect(server.ended).toEqual([SESSION]);
  });
});
