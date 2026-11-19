import { isAgentesCloud } from "./telemetry";

/**
 * The company details the published Terms of Use and Privacy Policy fill in (`docs/legal/`), and the switches that
 * decide which of their paragraphs apply to this installation (docs/adr/doug-0020-legal-pages.md). They are the
 * installation's own (`LEGAL_*` and the settings that turn each outside service on), never made up here: a company
 * field with no setting is null, and the page shows `[a preencher]` / `[to be filled]` in its place, which is how it
 * reads as the draft a legal review starts from.
 *
 * Nothing here is a secret: a service is a boolean, never its key or address. The retention numbers the documents quote
 * come from the same places that enforce them: voice recordings' `VOICE_RETENTION_DAYS` (ADR 0100) and the backup
 * service's `BACKUP_RETENTION_DAYS`, mirrored by `LEGAL_BACKUP_RETENTION_DAYS` (the compose service reads no app
 * config).
 */
export const LEGAL_SERVICES = [
  "platformKey",
  "jev",
  "giphy",
  "email",
  "media",
  "speech",
  "push",
  "pushDirect",
  "pushRelay",
  "composio",
  "embeddings",
  "whatsapp",
  "errors",
  "billing",
  "support",
  "telemetry",
  "driveBackup",
  "houseVoice",
] as const;
export type LegalService = (typeof LEGAL_SERVICES)[number];

export interface LegalFacts {
  companyName: string | null;
  taxId: string | null;
  address: string | null;
  dpoName: string | null;
  dpoEmail: string | null;
  serverLocation: string | null;
  logRetention: string | null;
  backupRetentionDays: number;
  voiceRetentionDays: number;
  /** The pages carry the "draft" notice: `LEGAL_DRAFT`, or a company field the documents need is still empty. */
  draft: boolean;
  /** Database backups go to a bucket (`S3_BACKUP_BUCKET`). */
  backup: boolean;
  /** Where files are kept: an S3 bucket, a folder on the server's disk, or the database itself. */
  storage: "s3" | "disk" | "database";
  /** This server is one of DougBot's own, where the usage report cannot be switched off. */
  telemetryForced: boolean;
  /**
   * Days a company's request to the waiting list is kept (`COMPANY_REQUESTS_RETENTION_DAYS`); null: no such form
   * here, and the Policy's section 12 is left out. The form is self-hosting's own (agentes.chat Cloud serves none),
   * and a retention of 0 keeps every request forever, which is no retention to promise either.
   */
  companyRequestsRetentionDays: number | null;
  /** Each optional outside service: on when the setting that turns it on is there. */
  services: Record<LegalService, boolean>;
}

/** The settings `legalFacts` reads, kept structural so the engine needs no dependency on the config package. */
export interface LegalSettings {
  PUBLIC_URL: string;
  LEGAL_COMPANY_NAME?: string;
  LEGAL_COMPANY_TAX_ID?: string;
  LEGAL_COMPANY_ADDRESS?: string;
  LEGAL_DPO_NAME?: string;
  LEGAL_DPO_EMAIL?: string;
  LEGAL_SERVER_LOCATION?: string;
  LEGAL_LOG_RETENTION?: string;
  LEGAL_BACKUP_RETENTION_DAYS: number;
  LEGAL_DRAFT: boolean;
  VOICE_RETENTION_DAYS: number;
  S3_BACKUP_BUCKET?: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  FILES_DIR?: string;
  TELEMETRY: "on" | "off";
  COMPANY_REQUESTS_RETENTION_DAYS?: number;
  PLATFORM_ANTHROPIC_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  GIPHY_API_KEY?: string;
  MILLIONSEND_API_KEY?: string;
  SMTP_URL?: string;
  ZIM_MEDIA_URL?: string;
  ZIM_MEDIA_SECRET?: string;
  EMPIRIO_API_KEY?: string;
  ASSEMBLYAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  SONIOX_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENAI_SPEECH_API_KEY?: string;
  DEEPINFRA_API_KEY?: string;
  PUSH_SENDER: "auto" | "direct" | "relay" | "off";
  FIREBASE_SERVICE_ACCOUNT?: unknown;
  APNS_KEY?: unknown;
  COMPOSIO_API_KEY?: string;
  EMBEDDINGS_PROVIDER: "none" | "voyage" | "openai";
  VOYAGE_API_KEY?: string;
  EMBEDDINGS_URL?: string;
  WHATSAPP_GATEWAY_URL?: string;
  WHATSAPP_GATEWAY_KEY?: string;
  SENTRY_DSN?: string;
  SENTRY_WEB_DSN?: string;
  BILLING_URL?: string;
  SUPPORT_EMAIL?: string;
  BACKUP_GOOGLE_DRIVE_FOLDER_ID?: string;
  BACKUP_GOOGLE_DRIVE_CLIENT_ID?: string;
  BACKUP_GOOGLE_DRIVE_CLIENT_SECRET?: string;
  BACKUP_GOOGLE_DRIVE_REFRESH_TOKEN?: string;
}

const trimmed = (value: string | undefined) => (value?.trim() ? value.trim() : null);
const set = (...values: unknown[]) => values.every((v) => (typeof v === "string" ? v.trim() !== "" : Boolean(v)));

export function legalFacts(config: LegalSettings): LegalFacts {
  const facts = {
    companyName: trimmed(config.LEGAL_COMPANY_NAME),
    taxId: trimmed(config.LEGAL_COMPANY_TAX_ID),
    address: trimmed(config.LEGAL_COMPANY_ADDRESS),
    dpoName: trimmed(config.LEGAL_DPO_NAME),
    dpoEmail: trimmed(config.LEGAL_DPO_EMAIL),
    serverLocation: trimmed(config.LEGAL_SERVER_LOCATION),
  };
  const cloud = isAgentesCloud(config.PUBLIC_URL);
  const s3 = set(config.S3_ENDPOINT, config.S3_BUCKET, config.S3_ACCESS_KEY_ID, config.S3_SECRET_ACCESS_KEY);
  const sender = config.PUSH_SENDER;
  const direct = { android: set(config.FIREBASE_SERVICE_ACCOUNT), ios: set(config.APNS_KEY) };
  return {
    ...facts,
    logRetention: trimmed(config.LEGAL_LOG_RETENTION),
    backupRetentionDays: config.LEGAL_BACKUP_RETENTION_DAYS,
    voiceRetentionDays: config.VOICE_RETENTION_DAYS,
    draft: config.LEGAL_DRAFT || Object.values(facts).some((v) => v === null),
    backup: set(config.S3_BACKUP_BUCKET),
    storage: s3 ? "s3" : set(config.FILES_DIR) ? "disk" : "database",
    telemetryForced: cloud,
    // The form is self-hosting's own (Cloud serves none), and a missing or 0 retention promises none: neither leaves
    // a §12, since neither has one to state. The schema refuses 0 at boot, so this is the older-row fallback alone.
    companyRequestsRetentionDays:
      cloud || !config.COMPANY_REQUESTS_RETENTION_DAYS ? null : config.COMPANY_REQUESTS_RETENTION_DAYS,
    services: {
      platformKey: set(config.PLATFORM_ANTHROPIC_API_KEY),
      jev: set(config.TYPESAFE_API_KEY),
      giphy: set(config.GIPHY_API_KEY),
      email: set(config.MILLIONSEND_API_KEY) || set(config.SMTP_URL),
      media: set(config.ZIM_MEDIA_URL, config.ZIM_MEDIA_SECRET),
      speech: [
        config.ASSEMBLYAI_API_KEY,
        config.ELEVENLABS_API_KEY,
        config.SONIOX_API_KEY,
        config.GROQ_API_KEY,
        config.OPENAI_SPEECH_API_KEY,
        config.DEEPINFRA_API_KEY,
      ].some((key) => set(key)),
      push: sender !== "off",
      // Straight to Firebase and Apple, with the server's own credentials for each.
      pushDirect: sender === "direct" || (sender === "auto" && (direct.android || direct.ios)),
      // The relay carries a phone's push wherever the server has no credentials of its own for that platform.
      pushRelay: sender === "relay" || (sender === "auto" && !(direct.android && direct.ios)),
      composio: set(config.COMPOSIO_API_KEY),
      // As the server itself decides (start.ts): without its key or address, no vectors and nothing leaves.
      embeddings:
        (config.EMBEDDINGS_PROVIDER === "voyage" && set(config.VOYAGE_API_KEY)) ||
        (config.EMBEDDINGS_PROVIDER === "openai" && set(config.EMBEDDINGS_URL)),
      whatsapp: set(config.WHATSAPP_GATEWAY_URL, config.WHATSAPP_GATEWAY_KEY),
      errors: set(config.SENTRY_DSN) || set(config.SENTRY_WEB_DSN),
      billing: set(config.BILLING_URL),
      support: set(config.SUPPORT_EMAIL),
      telemetry: cloud || config.TELEMETRY === "on",
      driveBackup: set(
        config.BACKUP_GOOGLE_DRIVE_FOLDER_ID,
        config.BACKUP_GOOGLE_DRIVE_CLIENT_ID,
        config.BACKUP_GOOGLE_DRIVE_CLIENT_SECRET,
        config.BACKUP_GOOGLE_DRIVE_REFRESH_TOKEN,
      ),
      // The house voice of calls (docs/adr/doug-0036-house-voice.md): its key and the wallet that pays it.
      houseVoice: set(config.EMPIRIO_API_KEY, config.ZIM_MEDIA_URL, config.ZIM_MEDIA_SECRET),
    },
  };
}

/** What a field with no setting shows, in each language the documents are written in. */
export const LEGAL_PLACEHOLDER = { "pt-BR": "[a preencher]", en: "[to be filled]" } as const;
