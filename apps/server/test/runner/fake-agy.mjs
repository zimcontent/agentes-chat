// A fake Antigravity CLI (`agy`) for runner tests. Each start appends its argv, cwd and the env that matters (its home,
// the MCP run and token, keys that must stay out) to $FAKE_AGY_LOG (one JSON line). Signed in: its token file,
// `antigravity-oauth-token` in $HOME/.gemini/antigravity-cli, as 1.5.0 keeps it with no keyring (JSON with its tokens
// and the home it signed in from; $FAKE_AGY_KEYRING: a file of its own instead, as a keyring would; $FAKE_AGY_BOUND:
// a copy in another home isn't signed in). `--version` prints a version line, `models` the models as Antigravity CLI
// 1.5.0 does (seen on Linux, 2026-11-11): "Fetching available models..." on stderr, then one model a line on stdout,
// its slug and name split by a tab; signed out "Please sign in…", an account Google won't serve "Eligibility check
// failed…", exit 1. $FAKE_AGY_CHECK, in a home named `.check` only (root's try of a copy): "slow" answers after a
// minute, "offline" can't reach Google.
// `acp --login` prints its Google sign-in link and prompt as 1.5.0 does and, as 1.5.x does, reads the pasted code only
// from its terminal (none: "no controlling terminal", exit 1), then exchanges it: a code with "bad" in it, or with paste
// marks it never turned on, is refused by Google (`invalid_grant`), one with "offline" can't reach Google, one with
// "ineligible" signs in an account `models` then refuses; else "Logged in as …", exit 0. `-p /usage` prints the
// quotas ($FAKE_AGY_REFRESH_MS: it refreshes its sign-in in place first, the file empty for that long), `-p /logout`
// signs out. `-p <prompt> --output-format stream-json` prints one turn: init (the conversation:
// `--conversation`'s, or a new one when it doesn't know that one; its tools: our server's alone with `--agent`, else
// the CLI's own and ours, or $FAKE_AGY_TOOLS), a text delta, a shell step (none with "BRIDGE_ONLY"), a call to our
// server (a tool of the CLI's own with "OWN_TOOL"), the last delta with usage and the result. "LIMIT": an AGY_ERROR
// quota line on stderr and exit 3. "DENIED": a command it refused without asking, and an empty answer
// ("DENIED_AGAIN": the nudge that follows is refused too). "ENV": the shell step's output is the env.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
const dir = path.join(env.HOME ?? "/nonexistent", ".gemini", "antigravity-cli");
const auth = path.join(dir, "antigravity-oauth-token");
const keyring = path.join(dir, "fake-keyring.json");
/** The sign-in it keeps, if any. */
const stored = () => {
  const file = [auth, keyring].find((f) => existsSync(f));
  return file ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (env.FAKE_AGY_LOG) {
  appendFileSync(
    env.FAKE_AGY_LOG,
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      home: env.HOME ?? null,
      run: env.AGENTES_MCP_RUN ?? null,
      token: env.AGENTES_MCP_TOKEN ?? null,
      geminiKey: env.GEMINI_API_KEY ?? null,
      dbus: env.DBUS_SESSION_BUS_ADDRESS ?? null,
      updates: env.AGY_CLI_DISABLE_AUTO_UPDATE ?? null,
    })}\n`,
  );
}
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (args[0] === "--version") {
  process.stdout.write("agy 1.4.12\n");
  process.exit(0);
}
if (args[0] === "models") {
  process.stderr.write("Fetching available models...\n");
  if (path.basename(env.HOME ?? "") === ".check" && env.FAKE_AGY_CHECK === "slow") {
    await new Promise((r) => setTimeout(r, 60_000));
  }
  if (path.basename(env.HOME ?? "") === ".check" && env.FAKE_AGY_CHECK === "offline") {
    process.stderr.write(
      'Error: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host\n',
    );
    process.exit(1);
  }
  const token = stored();
  if (!token || (env.FAKE_AGY_BOUND && token.home !== env.HOME)) {
    process.stderr.write(
      "Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n",
    );
    process.exit(1);
  }
  if (token.ineligible) {
    process.stderr.write(
      "Error: Eligibility check failed: PERMISSION_DENIED (code 403): The caller does not have permission\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n",
  );
  process.exit(0);
}
if (args[0] === "acp" && args[1] === "--login") {
  process.stdout.write(
    "Open this link in a browser to log in with Google:\r\n\r\n  https://accounts.google.com/o/oauth2/auth?client_id=agy&state=s1\r\n\r\nThen paste the authorization code, or the full URL of the page you land on, and press Enter:\r\n",
  );
  if (!process.stdin.isTTY) {
    process.stderr.write("Error: no controlling terminal; cannot complete interactive login\n");
    process.exit(1);
  }
  let code = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    code += chunk;
    if (/[\r\n]/.test(code)) break;
  }
  if (!code.trim() || code.includes("\x1b") || code.includes("bad")) {
    process.stdout.write('\r\ncouldn\'t log in: token exchange failed: oauth2: "invalid_grant" "Bad Request"\r\n');
    process.exit(1);
  }
  if (code.includes("offline")) {
    process.stdout.write(
      '\r\ncouldn\'t log in: token exchange failed: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host\r\n',
    );
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  const token = { access_token: "fake-access", refresh_token: "fake-refresh", token_type: "Bearer", home: env.HOME };
  writeFileSync(
    env.FAKE_AGY_KEYRING ? keyring : auth,
    JSON.stringify(code.includes("ineligible") ? { ...token, ineligible: true } : token),
    { mode: 0o600 },
  );
  process.stdout.write("Logged in as ana@example.com.\r\n");
  process.exit(0);
}
if (args[0] === "-p" && args[1] === "/usage") {
  if (env.FAKE_AGY_REFRESH_MS && existsSync(auth)) {
    const whole = readFileSync(auth, "utf8");
    writeFileSync(auth, "");
    await new Promise((r) => setTimeout(r, Number(env.FAKE_AGY_REFRESH_MS)));
    writeFileSync(auth, whole);
  }
  process.stdout.write(
    "Model quotas\n\nGemini Models\nWeekly Limit Remaining\n75%\nFive Hour Limit Remaining\n40% · resets in 2h 30m\n\nClaude and GPT models\nWeekly Limit Remaining\n100%\n",
  );
  process.exit(0);
}
if (args[0] === "-p" && args[1] === "/logout") {
  for (const f of [auth, keyring]) rmSync(f, { force: true });
  process.exit(0);
}

// `acp` (no `--login`): with $FAKE_AGY_ACP the Agent Client Protocol over stdio as 1.5.10 speaks it (tried
// 2026-11-18); without it, as an older CLI with no `acp`, exit 2. Each request is logged ({ acp: method, params }).
// A prompt says, by its words: by default "Let me check. ", a shell step, a call to our server (it asks for
// permission), "All good.\n" and usage. "SLOW": waits for the next prompt (a steer) and answers the first `end_turn` at
// once, then "Got it: <text>". "BACKGROUND": a command sent to the background, the prompt answered, then the command
// ends and the CLI wakes and says what it printed. "NETWORK": a `curl` outside the sandbox, which asks.
// "SHELL_OUT": `bash -c` outside the sandbox, which asks, then nothing said; the nudge ("Your last action…") goes on.
// "LIMIT": a quota error. "HANG": nothing until it is canceled.
if (args[0] === "acp" && !args.includes("--login")) {
  if (!env.FAKE_AGY_ACP) process.exit(2);
  const log = (o) => env.FAKE_AGY_LOG && appendFileSync(env.FAKE_AGY_LOG, `${JSON.stringify(o)}\n`);
  const known = path.join(dir, "fake-conversations.json");
  const conversations = () => (existsSync(known) ? JSON.parse(readFileSync(known, "utf8")) : []);
  const answer = (id, result) => out({ jsonrpc: "2.0", id, result });
  const refuse = (id, code, message) => out({ jsonrpc: "2.0", id, error: { code, message } });
  const update = (sessionId, u) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
  const waiting = new Map();
  let asked = 0;
  const ask = (params) =>
    new Promise((resolve) => {
      const id = `perm-${++asked}`;
      waiting.set(id, resolve);
      out({ jsonrpc: "2.0", id, method: "session/request_permission", params });
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** The prompt running now: a new one ends it (`end_turn`) and goes on. */
  let current = null;
  const say = (sid, text) => update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  const tool = async (sid, id, name, toolArgs, output, permission) => {
    update(sid, {
      sessionUpdate: "tool_call",
      toolCallId: id,
      name,
      args: toolArgs,
      status: "in_progress",
      kind: "execute",
      title: name,
    });
    let ok = true;
    if (permission) {
      const choice = await ask({
        sessionId: sid,
        toolCall: { sessionUpdate: "tool_call", toolCallId: id, name, args: toolArgs, status: "pending", title: name },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      });
      ok = choice?.optionId === "allow";
    }
    update(sid, {
      sessionUpdate: "tool_call_update",
      toolCallId: id,
      name,
      args: toolArgs,
      status: ok ? "completed" : "failed",
      ...(ok ? { rawOutput: { output, exit_code: 0 } } : {}),
    });
    return ok;
  };
  const usage = { inputTokens: 1000, outputTokens: 40, cachedReadTokens: 400, thoughtTokens: 30 };
  const run = async (id, sid, text) => {
    const me = { id, done: false };
    const prior = current;
    current = me;
    const steering = Boolean(prior && !prior.done);
    if (steering) {
      prior.done = true;
      answer(prior.id, { stopReason: "end_turn" });
    }
    const finish = (result) => {
      if (me.done) return;
      me.done = true;
      answer(id, result);
    };
    if (text.includes("LIMIT")) {
      me.done = true;
      return refuse(id, -32603, "Quota exceeded for Gemini 4 Argon. Resets in 2h 5m.");
    }
    if (text.includes("VERIFY")) {
      say(sid, "⚠ Verification Required");
      return finish({ stopReason: "end_turn" });
    }
    if (text.includes("HANG")) {
      me.cancel = () => finish({ stopReason: "cancelled" });
      return;
    }
    if (steering) {
      say(sid, `Got it: ${text}`);
      return finish({ stopReason: "end_turn", usage });
    }
    if (text.includes("SLOW")) {
      say(sid, "Working on it. ");
      await sleep(5000);
      return finish({ stopReason: "end_turn", usage });
    }
    if (text.includes("BACKGROUND")) {
      update(sid, {
        sessionUpdate: "tool_call",
        toolCallId: "bg1",
        name: "run_command",
        args: { CommandLine: "sleep 1 && echo slept", WaitMsBeforeAsync: 500 },
        status: "in_progress",
        kind: "execute",
      });
      say(sid, "Started it in the background.");
      finish({ stopReason: "end_turn", usage });
      await sleep(300);
      update(sid, {
        sessionUpdate: "tool_call_update",
        toolCallId: "bg1",
        name: "run_command",
        status: "completed",
        rawOutput: { output: "slept\n", exit_code: 0 },
      });
      await sleep(150);
      say(sid, "\n\nIt printed: slept");
      update(sid, { sessionUpdate: "usage_update", used: 100, size: 1000 });
      return;
    }
    if (text.includes("NETWORK")) {
      const ok = await tool(
        sid,
        "n1",
        "run_command",
        { BypassSandbox: true, CommandLine: "curl -sI https://example.com" },
        "HTTP/2 200\n",
        true,
      );
      say(sid, ok ? "It answered 200." : "It was refused.");
      return finish({ stopReason: "end_turn", usage });
    }
    if (text.includes("SHELL_OUT")) {
      await tool(
        sid,
        "s1",
        "run_command",
        { BypassSandbox: true, CommandLine: "bash -c 'curl https://example.com'" },
        "",
        true,
      );
      return finish({ stopReason: "end_turn", usage });
    }
    if (text.startsWith("Your last action")) {
      say(sid, "Done without it.");
      return finish({ stopReason: "end_turn", usage });
    }
    say(sid, "Let me check. ");
    if (!text.includes("BRIDGE_ONLY")) {
      await tool(sid, "t1", "run_command", { CommandLine: "bun test" }, "3 pass\n", false);
    }
    await tool(sid, "t2", "mcp_agenteschat_agentes_post_message", {}, "ok", true);
    say(sid, "All good.\n");
    finish({ stopReason: "end_turn", usage });
  };
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      if (m.method === undefined && waiting.has(m.id)) {
        const resolve = waiting.get(m.id);
        waiting.delete(m.id);
        resolve(m.result?.outcome);
        continue;
      }
      log({ acp: m.method, params: m.params ?? null, home: env.HOME ?? null, run: env.AGENTES_MCP_RUN ?? null });
      const p = m.params ?? {};
      if (m.method === "initialize") {
        answer(m.id, {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
          agentInfo: { name: "Antigravity ACP Server", version: "1.5.10" },
        });
      } else if (m.method === "session/new") {
        if (!stored()) refuse(m.id, -32000, "Authentication required");
        else {
          const list = conversations();
          const conversation = `c3b60000-0000-4000-8000-${String(list.length + 1).padStart(12, "0")}`;
          writeFileSync(known, JSON.stringify([...list, conversation]));
          answer(m.id, { sessionId: conversation });
        }
      } else if (m.method === "session/resume") {
        if (conversations().includes(p.sessionId)) answer(m.id, {});
        else refuse(m.id, -32603, `Failed to read session ${p.sessionId}`);
      } else if (["session/set_model", "session/set_mode", "session/set_config_option"].includes(m.method)) {
        answer(m.id, {});
      } else if (m.method === "session/prompt") {
        void run(m.id, p.sessionId, (p.prompt ?? []).map((b) => b.text ?? "").join("\n"));
      } else if (m.method === "session/cancel") {
        current?.cancel?.();
      } else if (m.id !== undefined) refuse(m.id, -32601, `Method not found: ${m.method}`);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  await new Promise(() => {});
}

if (args[0] === "-p") {
  const prompt = args[1] ?? "";
  if (!stored()) {
    process.stderr.write("Error: authentication required\n");
    process.exit(1);
  }
  const known = path.join(dir, "fake-conversations.json");
  const conversations = existsSync(known) ? JSON.parse(readFileSync(known, "utf8")) : [];
  let conversation = flag("--conversation");
  if (conversation && !conversations.includes(conversation)) {
    process.stderr.write(`warning: conversation ${conversation} not found, starting a new one\n`);
    conversation = undefined;
  }
  if (!conversation) {
    conversation = `c3b60000-0000-4000-8000-${String(conversations.length + 1).padStart(12, "0")}`;
    writeFileSync(known, JSON.stringify([...conversations, conversation]));
  }
  const tools = env.FAKE_AGY_TOOLS
    ? env.FAKE_AGY_TOOLS.split(",")
    : flag("--agent")
      ? ["agenteschat_agentes/post_message"]
      : ["ask_permission", "run_command", "write_to_file", "agenteschat_agentes/post_message"];
  const step = (o) => out({ event: "step_update", step_update: { conversation_id: conversation, ...o } });
  out({
    event: "init",
    conversation_id: conversation,
    init: {
      cwd: process.cwd(),
      tools,
      permission_mode: "request-review",
      ...(flag("--model") ? { model: flag("--model") } : {}),
    },
  });
  step({ step_index: 0, state: "DONE", step_type: "user_input" });
  if (prompt.includes("LIMIT")) {
    process.stderr.write(
      `AGY_ERROR: ${JSON.stringify({ status: "RESOURCE_EXHAUSTED", code: 429, retryable: true, message: "Quota exceeded for Gemini 4 Argon. Resets in 2h 5m." })}\n`,
    );
    out({ event: "result", result: { conversation_id: conversation, status: "ERROR", response: "", error: "quota" } });
    process.exit(3);
  }
  // No terminal sandbox (1.5.9, seen on Ubuntu 24.04, 2026-11-14): the command is soft-denied and the turn ends
  // "successfully" with nothing said.
  // A nudge after a denial (`agyDeniedNudge`) goes on, unless the turn was "DENIED_AGAIN": refused once more.
  const stubborn = path.join(dir, `fake-denied-again-${conversation}`);
  if (prompt.includes("DENIED_AGAIN")) writeFileSync(stubborn, "1");
  if (prompt.includes("DENIED") || (prompt.startsWith("Your last action") && existsSync(stubborn))) {
    step({
      step_index: 1,
      state: "DONE",
      step_type: "agent_response",
      usage: { input_tokens: 900, output_tokens: 40 },
    });
    out({
      event: "result",
      result: {
        conversation_id: conversation,
        status: "SUCCESS",
        response: "",
        denied_actions: [{ action: "command", display_name: "Bash" }],
      },
    });
    process.exit(0);
  }
  step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Let me check. " });
  if (!prompt.includes("BRIDGE_ONLY")) {
    step({
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "run_command",
      tool_info: {
        name: "run_command",
        parameters: { CommandLine: "bun test" },
        output: prompt.includes("ENV") ? JSON.stringify(env) : "3 pass\n",
      },
    });
  }
  const call = prompt.includes("OWN_TOOL") ? "view_file" : "agenteschat_agentes/post_message";
  step({
    step_index: 3,
    state: "DONE",
    step_type: "tool",
    tool_name: call,
    tool_info: { name: call, parameters: {}, output: "ok" },
  });
  step({
    step_index: 4,
    state: "DONE",
    step_type: "agent_response",
    text_delta: "All good.\n",
    usage: { input_tokens: 1000, output_tokens: 40, thinking_tokens: 30, cache_read_tokens: 400, total_tokens: 1040 },
  });
  out({
    event: "result",
    result: {
      conversation_id: conversation,
      status: "SUCCESS",
      response: "Let me check. All good.\n",
      num_turns: 1,
      usage: { input_tokens: 9000, output_tokens: 400, cache_read_tokens: 0, total_tokens: 9400 },
    },
  });
  process.exit(0);
}
process.exit(2);
