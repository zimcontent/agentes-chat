import type { ApprovalPortal } from "./approval-portal";
import type { BlobStore } from "./blob";
import type { DatabaseDriver } from "./database";
import type { EmailSender } from "./email";
import type { GifProvider } from "./gifs";
import type { HumanCheck } from "./human-check";
import type { KeyWrapper, PlatformCredentials } from "./keys";
import type { MailAdapters } from "./mail";
import type { Presence } from "./presence";
import type { PubSub } from "./pubsub";
import type { PushSender } from "./push";
import type { RateLimiter } from "./rate-limiter";
import type { SearchIndexResolver } from "./search";
import type { VaultSources } from "./vault/source";
import type { WebPushSender } from "./web-push";
import type { WhatsAppGateway } from "./whatsapp";
import type { ZimMedia } from "./zim-media";

export * from "./approval-portal";
export * from "./blob";
export * from "./blob-disk";
export * from "./blob-postgres";
export * from "./command-policy";
export * from "./composio";
export { parseAddressList } from "./composio-mail";
export * from "./database";
export * from "./email";
export * from "./error-reports";
export * from "./error-scrub";
export * from "./file-backup";
export * from "./gifs";
export { cleanOutside, decodeEntities, hasInvisible, htmlToText, replaceDisguised } from "./html-text";
export * from "./human-check";
export * from "./imap";
export * from "./keys";
export * from "./machine-protocol";
export * from "./mail";
export * from "./mail-fake";
export * from "./mail-presets";
export * from "./outbound-url";
export * from "./presence";
export * from "./pubsub";
export * from "./push";
export * from "./push-apns";
export * from "./push-fcm";
export * from "./push-relay";
export * from "./rate-limiter";
export * from "./read-capped";
export * from "./redact";
export * from "./s3";
export * from "./s3-fake";
export * from "./sandbox";
export * from "./search";
export * from "./secret-box";
export * from "./speech";
export * from "./standard-webhooks";
export * from "./stopwords";
export * from "./storage-host";
export { createBitwardenSource } from "./vault/bitwarden";
export { createOnePasswordSource } from "./vault/onepassword";
export * from "./vault/site";
export * from "./vault/source";
export * from "./video-glance";
export * from "./video-light";
export * from "./voice-out";
export * from "./web-push";
export * from "./whatsapp";
export * from "./zim-media";

/**
 * Infrastructure the core talks to through interfaces, so each edition can
 * plug its own implementation (ADR 0002). The server builds
 * core defaults, then applies each module's overrides in order.
 */
export interface Adapters {
  search: SearchIndexResolver;
  pubsub: PubSub;
  presence: Presence;
  rateLimiter: RateLimiter;
  keyWrapper: KeyWrapper;
  /** Extra wrappers that can only unwrap (old keys during rotation). */
  legacyKeyWrappers: KeyWrapper[];
  platformCredentials: PlatformCredentials;
  /** Transactional email (sent from the `email.send` outbox job). */
  email: EmailSender;
  /**
   * Platform file storage (our bucket, a folder on disk, or Postgres). Orgs with
   * their own bucket are resolved on top of it by the engine.
   */
  platformBlobs: BlobStore;
  /** Push to the phone app (`push.send` outbox job, ADR 0035); null/absent = no push. */
  push?: PushSender | null;
  /** Web Push to browsers (`push.send` outbox job, ADR 0071); null/absent = browsers get no push. */
  webPush?: WebPushSender | null;
  /** People's mailboxes for agents (ADR 0038); absent = no email connectors. */
  mail?: MailAdapters;
  /** People's Postgres databases for agents (ADR 0039); null/absent = no database connector. */
  databases?: DatabaseDriver | null;
  /** A bot check before public forms (ADR 0075): Turnstile when both of its keys are set; null/absent = none. */
  humanCheck?: HumanCheck | null;
  /**
   * GIF search (ADR 0091): GIPHY with `GIPHY_API_KEY`, or, on a server that isn't agentes.chat's own, the provider
   * that follows the installation's key (`createKeyedGifs`), whose `available()` says whether it has one now;
   * null/absent = no GIFs.
   */
  gifs?: GifProvider | null;
  /**
   * The approval portal (ADR 9001), reached through the installation's bridge (`APPROVAL_PORTAL_URL`);
   * null/absent = no portal: no page, no tools. On a server with no bridge, the portal kept in this server's own
   * database takes its place (docs/adr/doug-0031-embedded-approval-portal.md): `approvalPortal` is that one there, and
   * `approvalPortalEmbedded` says so, so the client links and their notices are wired.
   */
  approvalPortal?: ApprovalPortal | null;
  /** True when `approvalPortal` is this server's own (`createEmbeddedApprovalPortal`), not the bridge. */
  approvalPortalEmbedded?: boolean;
  /**
   * The Vault's external sources by kind (ADR 0144): 1Password and Bitwarden by default, a module's merged by kind.
   * The built-in source is the engine's own. null/absent = only built-in items.
   */
  vaultSources?: VaultSources | null;
  /**
   * WhatsApp numbers people connect (`WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_KEY`); null/absent = no WhatsApp
   * anywhere in the app.
   */
  whatsapp?: WhatsAppGateway | null;
  /**
   * Image and video generation paid in credits (ADR doug-0011), through the Zim Mídia service (`ZIM_MEDIA_URL`,
   * `ZIM_MEDIA_SECRET`); null/absent = no media page, no wallet, no `generate_image`/`generate_video`.
   */
  zimMedia?: ZimMedia | null;
}
