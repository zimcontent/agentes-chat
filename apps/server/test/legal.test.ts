import { describe, expect, test } from "bun:test";
import { browser, createTestServer } from "./harness";

const NO_SERVICES = {
  platformKey: false,
  jev: false,
  giphy: false,
  email: false,
  media: false,
  speech: false,
  push: false,
  pushDirect: false,
  pushRelay: false,
  composio: false,
  embeddings: false,
  whatsapp: false,
  errors: false,
  billing: false,
  support: false,
  telemetry: false,
  driveBackup: false,
  houseVoice: false,
};

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
      // The draft notice shows until a lawyer's review turns it off, and no paragraph of an outside service applies.
      draft: true,
      backup: false,
      storage: "database",
      telemetryForced: false,
      companyRequestsRetentionDays: 365,
      services: { ...NO_SERVICES, push: true, pushRelay: true, telemetry: true },
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
      draft: true,
      backup: false,
      storage: "database",
      telemetryForced: false,
      companyRequestsRetentionDays: 365,
      services: { ...NO_SERVICES, push: true, pushRelay: true, telemetry: true },
    });
    await t.close();
  });

  test("the draft notice goes only when LEGAL_DRAFT is false and every company field is set", async () => {
    const company = {
      LEGAL_COMPANY_NAME: "Padaria Aurora Serviços Ltda.",
      LEGAL_COMPANY_TAX_ID: "00.000.000/0001-00",
      LEGAL_COMPANY_ADDRESS: "Rua das Flores, 100",
      LEGAL_DPO_NAME: "Ana Lima",
      LEGAL_DPO_EMAIL: "dpo@example.com",
      LEGAL_SERVER_LOCATION: "Brasil (São Paulo)",
    };
    const draftOf = async (env: Record<string, string>) => {
      const t = await createTestServer({ env });
      const facts = (await (await browser(t)("/api/app/legal")).json()) as { draft: boolean };
      await t.close();
      return facts.draft;
    };
    expect(await draftOf({ ...company, LEGAL_DRAFT: "false" })).toBe(false);
    expect(await draftOf(company)).toBe(true);
    const { LEGAL_DPO_EMAIL: _gone, ...missing } = company;
    expect(await draftOf({ ...missing, LEGAL_DRAFT: "false" })).toBe(true);
  });

  test("each service is on by its own setting, and the answer never holds a key or an address", async () => {
    const t = await createTestServer({
      env: {
        TYPESAFE_API_KEY: "tsk-secret-jev-key",
        PLATFORM_ANTHROPIC_API_KEY: "sk-ant-secret-platform",
        GIPHY_API_KEY: "giphy-secret",
        SUPPORT_EMAIL: "support@example.com",
        WHATSAPP_GATEWAY_URL: "http://whatsapp:8080",
        WHATSAPP_GATEWAY_KEY: "whatsapp-secret",
        EMBEDDINGS_PROVIDER: "voyage",
        VOYAGE_API_KEY: "voyage-secret",
        S3_BACKUP_BUCKET: "doug-backups",
        S3_ENDPOINT: "https://s3.example.com",
        S3_BUCKET: "files",
        S3_ACCESS_KEY_ID: "s3-id",
        S3_SECRET_ACCESS_KEY: "s3-secret",
        PUSH_SENDER: "off",
        TELEMETRY: "off",
      },
    });
    const res = await browser(t)("/api/app/legal");
    const text = await res.text();
    const facts = JSON.parse(text) as { services: Record<string, boolean>; backup: boolean; storage: string };
    expect(facts.services).toMatchObject({
      jev: true,
      platformKey: true,
      giphy: true,
      support: true,
      whatsapp: true,
      embeddings: true,
      media: false,
      composio: false,
      push: false,
      pushRelay: false,
      telemetry: false,
    });
    expect(facts.backup).toBe(true);
    expect(facts.storage).toBe("s3");
    for (const secret of [
      "tsk-secret",
      "sk-ant-secret",
      "giphy-secret",
      "whatsapp-secret",
      "voyage-secret",
      "s3-secret",
      "doug-backups",
      "support@example.com",
      "whatsapp:8080",
    ]) {
      expect(text).not.toContain(secret);
    }
    await t.close();
  });

  test("the usage report is on by default, cannot be switched off on agentes.chat's own hosts, and off with TELEMETRY=off", async () => {
    const t1 = await createTestServer();
    expect(
      ((await (await browser(t1)("/api/app/legal")).json()) as { services: { telemetry: boolean } }).services.telemetry,
    ).toBe(true);
    await t1.close();
    const t2 = await createTestServer({ env: { TELEMETRY: "off", PUBLIC_URL: "https://app.agentes.chat" } });
    const forced = (await (await browser(t2)("/api/app/legal")).json()) as {
      telemetryForced: boolean;
      services: { telemetry: boolean };
    };
    expect([forced.telemetryForced, forced.services.telemetry]).toEqual([true, true]);
    await t2.close();
  });

  test("the waiting list's retention reads as its setting: 365 by default, the value given, and none on the Cloud", async () => {
    const daysOf = async (env: Record<string, string> = {}) => {
      const t = await createTestServer({ env });
      const facts = (await (await browser(t)("/api/app/legal")).json()) as {
        companyRequestsRetentionDays: number | null;
      };
      await t.close();
      return facts.companyRequestsRetentionDays;
    };
    expect(await daysOf()).toBe(365);
    expect(await daysOf({ COMPANY_REQUESTS_RETENTION_DAYS: "180" })).toBe(180);
    // The form is self-hosting's own: on DougBot's own servers the Policy says nothing of it, whatever the value.
    expect(await daysOf({ PUBLIC_URL: "https://app.agentes.chat", COMPANY_REQUESTS_RETENTION_DAYS: "180" })).toBeNull();
    // A retention of 0 promised nothing to erase, so the setting no longer takes it: below 1, the server refuses it at
    // boot instead of quietly promising what the sweep wouldn't do.
    await expect(createTestServer({ env: { COMPANY_REQUESTS_RETENTION_DAYS: "0" } })).rejects.toThrow();
  });

  test("it is listed in the OpenAPI document", async () => {
    const t = await createTestServer();
    const doc = (await (await t.app.request("/api/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain("/app/legal");
    await t.close();
  });

  test("auth-config links this server's own pages only when it names its company, and a setting of its own wins", async () => {
    const plain = await createTestServer({ env: { PUBLIC_URL: "https://chat.example.com" } });
    expect(await (await browser(plain)("/api/app/auth-config")).json()).toMatchObject({
      termsUrl: null,
      privacyUrl: null,
    });
    await plain.close();
    const named = await createTestServer({
      env: { PUBLIC_URL: "https://chat.example.com", LEGAL_COMPANY_NAME: "Padaria Aurora Serviços Ltda." },
    });
    expect(await (await browser(named)("/api/app/auth-config")).json()).toMatchObject({
      termsUrl: "https://chat.example.com/termos",
      privacyUrl: "https://chat.example.com/privacidade",
    });
    await named.close();
    const own = await createTestServer({
      env: {
        PUBLIC_URL: "https://chat.example.com",
        LEGAL_COMPANY_NAME: "Café Sol",
        TERMS_URL: "https://example.org/terms",
      },
    });
    expect(await (await browser(own)("/api/app/auth-config")).json()).toMatchObject({
      termsUrl: "https://example.org/terms",
      privacyUrl: "https://chat.example.com/privacidade",
    });
    await own.close();
  });
});
