/**
 * The company details the published Terms of Use and Privacy Policy fill in (`docs/legal/`). They are the
 * installation's own (`LEGAL_*`), never made up here: a field with no setting is null, and the page shows
 * `[a preencher]` / `[to be filled]` in its place, which is how it reads as the draft a legal review starts from.
 *
 * The retention numbers the documents quote come from the same places that enforce them: voice recordings'
 * `VOICE_RETENTION_DAYS` (ADR 0100) and the backup service's `BACKUP_RETENTION_DAYS`, mirrored by
 * `LEGAL_BACKUP_RETENTION_DAYS` (the compose service reads no app config).
 */
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
}

/** The settings `legalFacts` reads, kept structural so the engine needs no dependency on the config package. */
export interface LegalSettings {
  LEGAL_COMPANY_NAME?: string;
  LEGAL_COMPANY_TAX_ID?: string;
  LEGAL_COMPANY_ADDRESS?: string;
  LEGAL_DPO_NAME?: string;
  LEGAL_DPO_EMAIL?: string;
  LEGAL_SERVER_LOCATION?: string;
  LEGAL_LOG_RETENTION?: string;
  LEGAL_BACKUP_RETENTION_DAYS: number;
  VOICE_RETENTION_DAYS: number;
}

const trimmed = (value: string | undefined) => (value?.trim() ? value.trim() : null);

export function legalFacts(config: LegalSettings): LegalFacts {
  return {
    companyName: trimmed(config.LEGAL_COMPANY_NAME),
    taxId: trimmed(config.LEGAL_COMPANY_TAX_ID),
    address: trimmed(config.LEGAL_COMPANY_ADDRESS),
    dpoName: trimmed(config.LEGAL_DPO_NAME),
    dpoEmail: trimmed(config.LEGAL_DPO_EMAIL),
    serverLocation: trimmed(config.LEGAL_SERVER_LOCATION),
    logRetention: trimmed(config.LEGAL_LOG_RETENTION),
    backupRetentionDays: config.LEGAL_BACKUP_RETENTION_DAYS,
    voiceRetentionDays: config.VOICE_RETENTION_DAYS,
  };
}

/** What a field with no setting shows, in each language the documents are written in. */
export const LEGAL_PLACEHOLDER = { "pt-BR": "[a preencher]", en: "[to be filled]" } as const;
