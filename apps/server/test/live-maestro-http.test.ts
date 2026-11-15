import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

/**
 * A maestro call over HTTP (docs/adr/doug-0006-live-voice.md §11): what a person said reaches the server as a recording
 * (multipart), which the app router's JSON-only guard must let through for this route alone.
 */

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

test("a person's words on a maestro call go up as a recording (multipart), not refused as non-JSON", async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const created = (await (await owner("/api/app/organizations", { json: { name: "Acme" } })).json()) as {
    organization: { id: string };
  };
  const form = new FormData();
  form.set("file", new File([new Uint8Array(64)], "heard.wav", { type: "audio/wav" }));
  form.set("durationMs", "1500");
  form.set("language", "pt-BR");
  const room = crypto.randomUUID();
  const res = await owner(`/api/app/organizations/${created.organization.id}/live-rooms/${room}/heard`, {
    method: "POST",
    body: form,
  });
  // Past the guard: the room doesn't exist (no maestro here), but the recording was read.
  expect(res.status).not.toBe(415);
  expect([403, 404]).toContain(res.status);
});
