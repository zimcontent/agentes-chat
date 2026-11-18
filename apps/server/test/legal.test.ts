import { describe, expect, test } from "bun:test";
import { browser, createTestServer } from "./harness";

describe("GET /api/app/legal", () => {
  test("public, with nothing signed in: a fresh installation has no company details, and its retention numbers", async () => {
    const t = await createTestServer();
    const res = await browser(t)("/api/app/legal");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      companyName: null,
      taxId: null,
      address: null,
      dpoName: null,
      dpoEmail: null,
      serverLocation: null,
      logRetention: null,
      // The backup service's default, and voice's (`VOICE_RETENTION_DAYS`).
      backupRetentionDays: 14,
      voiceRetentionDays: 90,
    });
    await t.close();
  });

  test("the LEGAL_* settings fill it in, and the voice retention follows VOICE_RETENTION_DAYS", async () => {
    const t = await createTestServer({
      env: {
        LEGAL_COMPANY_NAME: "Padaria Aurora Serviços Ltda.",
        LEGAL_COMPANY_TAX_ID: "00.000.000/0001-00",
        LEGAL_COMPANY_ADDRESS: "Rua das Flores, 100, São Paulo, SP",
        LEGAL_DPO_NAME: "Ana Lima",
        LEGAL_DPO_EMAIL: "dpo@example.com",
        LEGAL_SERVER_LOCATION: "Brasil (São Paulo)",
        LEGAL_BACKUP_RETENTION_DAYS: "30",
        LEGAL_LOG_RETENTION: "90 dias",
        VOICE_RETENTION_DAYS: "7",
      },
    });
    expect(await (await browser(t)("/api/app/legal")).json()).toEqual({
      companyName: "Padaria Aurora Serviços Ltda.",
      taxId: "00.000.000/0001-00",
      address: "Rua das Flores, 100, São Paulo, SP",
      dpoName: "Ana Lima",
      dpoEmail: "dpo@example.com",
      serverLocation: "Brasil (São Paulo)",
      logRetention: "90 dias",
      backupRetentionDays: 30,
      voiceRetentionDays: 7,
    });
    await t.close();
  });

  test("it is listed in the OpenAPI document", async () => {
    const t = await createTestServer();
    const doc = (await (await t.app.request("/api/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain("/app/legal");
    await t.close();
  });

  test("auth-config reports this server's own pages as the legal links, with no setting", async () => {
    const t = await createTestServer({ env: { PUBLIC_URL: "https://chat.example.com" } });
    expect(await (await browser(t)("/api/app/auth-config")).json()).toMatchObject({
      termsUrl: "https://chat.example.com/termos",
      privacyUrl: "https://chat.example.com/privacidade",
    });
    await t.close();
  });
});
