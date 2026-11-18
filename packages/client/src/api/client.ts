import type { AppLocale } from "@agenteschat/i18n/locale";
import type { PlanModel } from "@agenteschat/providers/plans";
import type { DashboardsApi } from "../dashboards/api";
import type { ChatPrefs } from "../lib/chat-look";
import type { OnboardingStepId } from "../lib/onboarding";
import type { LegacyPrefsPatch, LodiPrefs, LodiPrefsPatch } from "../lib/right-hand-prefs";
import type { Seat } from "../lib/seat";
import type { TeamWeekAct } from "../lib/team-week";
import type { AudienceChoice } from "../lib/who-sees";
import type { WikiAccess } from "../lib/wiki";
import type { WorkAreaAnswer } from "../lib/work-area";
import type { MediaApi } from "../media/types";
import type {
  SecretToVaultInput,
  VaultConnectInput,
  VaultConnection,
  VaultConnectionPatch,
  VaultImportResult,
  VaultItem,
  VaultItemDetail,
  VaultItemInput,
  VaultItemPatch,
  VaultKeysImportInput,
  VaultKeysImportResult,
  VaultOverview,
  VaultScope,
} from "../vault/types";
import type {
  DesignEditInput,
  PersonWorkInput,
  ReviewPost,
  ReviewPostPatch,
  ReviewWhatsAppTarget,
  VideoReview,
  VideoReviewDecision,
  VideoReviewNote,
  VideoReviewNoteInput,
  VideoReviewSummary,
  VideoReviewVoiceInput,
} from "../video-reviews/types";
import type {
  WhatsAppAccount,
  WhatsAppAccountPatch,
  WhatsAppBrain,
  WhatsAppBrainInput,
  WhatsAppChatPage,
  WhatsAppInstructionsDraft,
  WhatsAppMessagePage,
  WhatsAppOverview,
  WhatsAppSendInput,
  WhatsAppVoices,
} from "../whatsapp/types";
import type { UploadOptions } from "./http";
import type {
  AccessInput,
  AccountDeletionPlan,
  AccountLoginStart,
  AccountLoginStatus,
  ActiveRun,
  AdminAsk,
  Agent,
  AgentAccess,
  AgentAction,
  AgentAudience,
  AgentBrain,
  AgentBrainInput,
  AgentBrowserSettings,
  AgentChannel,
  AgentComputer,
  AgentDatabase,
  AgentDatabaseInput,
  AgentDetail,
  AgentForYou,
  AgentGroup,
  AgentGroupPatch,
  AgentHolds,
  AgentInput,
  AgentLineChange,
  AgentMailbox,
  AgentMailboxInput,
  AgentPlanUsage,
  AgentProposal,
  AgentQuestion,
  AgentSecret,
  AgentSetup,
  AgentSetupResult,
  AgentSkill,
  AgentStatus,
  AgentStyle,
  AgentTwins,
  AgentUsage,
  AiAccounts,
  AiStatus,
  ApiRule,
  AppConsent,
  AppConsentDecision,
  AppNotification,
  Approval,
  ApprovalCoverInput,
  ApprovalCovers,
  ApprovalRule,
  ApprovalsLevel,
  AppsList,
  ArchivedChannel,
  Artifact,
  ArtifactContent,
  ArtifactDetail,
  ArtifactFilters,
  ArtifactPage,
  ArtifactSharing,
  ArtifactVersion,
  AskToJoinResult,
  AuditPage,
  AuditQuery,
  AuthConfig,
  BatchInviteResult,
  BillingFrom,
  BlockState,
  BrainKind,
  BrainMachine,
  BrainScope,
  BrandInput,
  BrandToneWord,
  BrandView,
  BrowserHandoff,
  BrowserProfile,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarRange,
  CarryResult,
  CarrySource,
  Channel,
  ChannelCard,
  ChannelCategory,
  ChannelInput,
  ChannelMember,
  ChannelOverride,
  Choices,
  CliInstall,
  CodeSent,
  CommandApproval,
  CompanyRequest,
  CompanyRequestInvite,
  CompanyRequestPage,
  CompanyRequestStatus,
  ComposioUsage,
  ComputerDevice,
  ComputerDeviceInput,
  ComputerQueue,
  ComputerSetup,
  ComputerTarget,
  Connection,
  ConnectLink,
  ConnectLinkState,
  ConnectOutcome,
  ConnectorCatalog,
  ConsultationConversation,
  CostlyDecision,
  CreatedPersonalToken,
  Credential,
  CustomConnectStart,
  CustomServer,
  DatabaseActionName,
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseTable,
  DeletionProofInput,
  DesktopPictureView,
  DesktopRelease,
  DesktopStatus,
  DeviceAccount,
  DeviceAudience,
  DeviceRequest,
  DevicesList,
  DirectMessage,
  DmRead,
  DmTarget,
  DougTeamTemplate,
  EmailChange,
  EndpointCheck,
  EndpointModel,
  EndpointStyle,
  FeedbackFile,
  FeedbackInput,
  FeedbackOffer,
  ForeignMailbox,
  FormerAgent,
  GifKey,
  GifPage,
  GifQuery,
  GitHubAppInfo,
  GitHubAppInstallation,
  GitHubAppSetup,
  GitHubOrgAccess,
  GitHubRepositories,
  Health,
  HostComputer,
  IdRef,
  ImportedFile,
  ImportedSource,
  ImportFileInput,
  ImportInput,
  ImportPlan,
  InstallableCli,
  Instance,
  Invitation,
  InvitationPreview,
  InvitationState,
  InvitationWithStatus,
  InviteBatch,
  InviteLink,
  InviteLinkChanged,
  InviteLinkChoices,
  InviteLinkMade,
  Issue,
  IssueActivity,
  IssueColumn,
  IssueConversationRef,
  IssueInput,
  IssuePatch,
  IssueProject,
  IssueProjectRef,
  IssueProjects,
  IssueStatus,
  IssuesView,
  JevKey,
  JevKeyInput,
  JoinApproval,
  JoinClaim,
  JoinRequest,
  LearnedSkill,
  LegalFacts,
  LiveRoom,
  LiveSession,
  LiveSessionInput,
  LiveSpeakerAsk,
  LiveSpeakerPick,
  LiveVoice,
  Machine,
  MachineAccess,
  MachineAccessReduce,
  MachineAccount,
  MachineAccountKind,
  MachineOutages,
  MachinePause,
  MachineTask,
  MachineTool,
  MailAccount,
  MailAccountUpdate,
  MailFolder,
  MailImapInput,
  MailProviders,
  Me,
  Member,
  Memory,
  Message,
  MessageCard,
  MessagePin,
  Mission,
  MissionBrain,
  MissionCommand,
  MissionCommandDecision,
  MissionCommandRule,
  MissionControl,
  MissionCreateInput,
  MissionDecision,
  MissionDelivery,
  MissionEligibleAgent,
  MissionExecutor,
  MissionFiles,
  MissionJoinRequest,
  MissionList,
  MissionListQuery,
  MissionParticipantRole,
  MissionParticipants,
  MissionPlan,
  MissionReview,
  MissionSettings,
  MissionSummary,
  Model,
  ModelTier,
  MoveAgentsInput,
  MoveAgentsResult,
  MySuggestion,
  NewAgentSetup,
  NoticeCategory,
  NoticePrefs,
  NotificationCount,
  NotificationFilter,
  NotificationPage,
  Organization,
  OrgOverview,
  OrgPlanUsage,
  OrgRoles,
  OrgSettings,
  PageTarget,
  PendingReturn,
  PeopleUsage,
  Person,
  PersonalTokenInput,
  PersonLimits,
  PersonUsage,
  PhoneDevice,
  PhoneDeviceInput,
  PhoneSignIn,
  PlanServes,
  Poll,
  PortalBoard,
  PortalCard,
  PortalCardInput,
  PortalClientAccount,
  PortalClientColor,
  PortalClientsList,
  PortalContact,
  PortalItem,
  PortalItemEdit,
  PortalJob,
  PortalLabel,
  PortalLabelColor,
  PortalList,
  PortalListKind,
  PortalMine,
  PortalNoticeNumber,
  PortalOverview,
  PortalPipeline,
  PortalPlan,
  PortalSendInput,
  PortalTaskRef,
  PostMedia,
  Proposal,
  PushDeviceInput,
  ReactionCount,
  ReadOnlyOrgSettings,
  Reminder,
  ReminderInput,
  RemovalPreview,
  RequestHeader,
  RightHandApprovals,
  RightHandApprovalsInput,
  Role,
  RoleInput,
  RoleMailLoss,
  Ronda,
  RondaSchedule,
  RosterMember,
  Routine,
  RoutineHook,
  RoutineInput,
  RoutinePatch,
  RoutineRun,
  RowHolders,
  RuleInfo,
  Run,
  RunConsultation,
  RunStep,
  S3Input,
  SandboxSettings,
  SandboxSettingsInput,
  ScheduleParse,
  ScopeGrant,
  ScreenKind,
  SearchFilterInput,
  SearchHit,
  SearchKind,
  SecretBox,
  SecretRequest,
  SeriesScope,
  ServerTelemetry,
  SetupStep,
  SidebarItem,
  SidebarItems,
  SidebarPlace,
  SidebarSection,
  SidebarView,
  SignInOptions,
  Skill,
  SkillDetail,
  SkillInput,
  SkillPatch,
  SkillPick,
  SkillSettings,
  SkillSourceUpdate,
  SpeechKey,
  SpeechKeyInput,
  StartChoice,
  StartPage,
  StatusInput,
  StorageConfig,
  StorageMigration,
  StorageSave,
  StorageTestResult,
  SuggestedAi,
  TaskManagerView,
  TaskOutput,
  TaskSteps,
  Team,
  TeamAgenda,
  TeamAgentDraft,
  TeamProposalCard,
  TeamTemplate,
  ThreadAction,
  ThreadCreateInput,
  ThreadFilters,
  ThreadFollow,
  ThreadInfo,
  ThreadPage,
  ThreadPatch,
  ToolDecision,
  TrashedArtifact,
  UndoAllResult,
  UnreadTask,
  UsageQueue,
  UsageReport,
  WaitingList,
  WebhookProvider,
  WebhookSetup,
  WifiIphones,
  WifiPairing,
  WikiBulkFailed,
  WikiBulkTarget,
  WikiFolderAudience,
  WikiGraph,
  WikiImportInput,
  WikiImportResult,
  WikiPage,
  WikiPageInput,
  WikiPageSummary,
  WikiTopRead,
  WikiUpdateInput,
  WikiVersion,
  WorkingRun,
  WorkspaceActionCard,
  WorkspaceActionCardView,
  WorkspaceLimits,
  WorkspaceMode,
  XcodeFixView,
} from "./types";

/**
 * Everything the web app asks the backend. `createApiClient` (./index.ts)
 * wires the HTTP implementation (./http-client.ts); tests pass a fake
 * (test/fake-api.ts). Components never call `fetch` directly.
 */
/** Where a workspace whose onboarding just ended opens (its right hand's DM) and `/me` as it is now. */
export interface OpenedWorkspace {
  rightHandId?: string | null;
  me?: Me;
}

export interface ApiClient {
  system: {
    health(): Promise<Health>;
    instance(): Promise<Instance>;
    /** The company details the legal pages fill in (`LEGAL_*`): public, nothing secret. */
    legal(): Promise<LegalFacts>;
    /** `null` unless I am the installation's owner (and not on agentes.chat itself). */
    telemetry(): Promise<ServerTelemetry | null>;
    setTelemetry(enabled: boolean): Promise<ServerTelemetry>;
    /** By email to whoever runs the server; only where it takes feedback (`AuthConfig.feedback`). */
    sendFeedback(input: FeedbackInput): Promise<void>;
    /** A picture or a video for the feedback being written: kept an hour unless it is sent. */
    uploadFeedbackFile(file: File): Promise<FeedbackFile>;
    dropFeedbackFile(id: string): Promise<void>;
    /**
     * A report an agent offered under its reply (`meta.feedbackOffer`): I send it or put it away, once. Answers with
     * the offer as it stands.
     */
    decideFeedbackOffer(orgId: string, messageId: string, decision: "send" | "dismiss"): Promise<FeedbackOffer>;
    /** `null` unless I am the installation's owner on a self-hosted server. */
    jev(): Promise<JevKey | null>;
    /**
     * A pasted key (TypeSafe's, or OpenRouter's), or the workspace's own OpenRouter key. Checked first:
     * `jev_key_invalid` (422) when it is refused, `jev_key_env` (409) with an env key.
     */
    saveJev(input: JevKeyInput): Promise<JevKey>;
    checkJev(): Promise<JevKey>;
    removeJev(): Promise<JevKey>;
    /** The GIPHY key (ADR 0091): `null` unless I am the installation's owner on a self-hosted server. */
    gifKey(): Promise<GifKey | null>;
    /** Checked with GIPHY first: `gif_key_invalid` (422) when it refuses, `gif_key_env` (409) with an env key. */
    saveGifKey(apiKey: string): Promise<GifKey>;
    removeGifKey(): Promise<GifKey>;
    /** The speech engine (ADR 0100): `null` unless I am the installation's owner on a self-hosted server. */
    speechKey(): Promise<SpeechKey | null>;
    /** Tried with the provider first: `speech_key_invalid` (422) when it refuses. */
    saveSpeechKey(input: SpeechKeyInput): Promise<SpeechKey>;
    removeSpeechKey(): Promise<SpeechKey>;
    /**
     * The company requests, newest first (`GET /api/app/companies`): `null` unless I am the installation's owner on a
     * self-hosted server.
     */
    companyRequests(query?: {
      status?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    }): Promise<CompanyRequestPage | null>;
    companyRequest(id: string): Promise<CompanyRequest>;
    setCompanyStatus(id: string, status: CompanyRequestStatus): Promise<CompanyRequest>;
    saveCompanyNotes(id: string, notes: string): Promise<CompanyRequest>;
    saveCompanyClientCode(id: string, clientCode: string | null): Promise<CompanyRequest>;
    /** Erases the request and everything it holds (LGPD): `DELETE …/companies/{id}`. */
    deleteCompanyRequest(id: string): Promise<void>;
    /** Sends the company its early-access link: `early_access.no_email` (409) where the server sends no email. */
    inviteCompany(id: string): Promise<CompanyRequestInvite>;
  };
  /** Voice messages (ADR 0100). */
  voice: {
    /** Whether I may record now: fair use, on agentes.chat's own servers. */
    allowed(orgId: string): Promise<{ allowed: boolean }>;
    /** Stores a recording; its message arrives over the socket with this `clientId`. */
    send(
      orgId: string,
      channelId: string,
      input: {
        blob: Blob;
        durationMs: number;
        peaks: number[];
        clientId: string;
        threadId?: string | null;
        replyTo?: string | null;
        language?: string | null;
        /** Typed beside the take: one message carries both. */
        text?: string | null;
        /** Files (artifact ids) sent with the take. */
        attachments?: string[];
      },
    ): Promise<{ clipId: string }>;
  };
  /** Live voice with GPT-Live (ADR doug-0006): the workspace's key, sessions, and voice rooms with people and agents. */
  liveVoice: {
    get(orgId: string): Promise<LiveVoice>;
    saveKey(orgId: string, apiKey: string): Promise<LiveVoice>;
    removeKey(orgId: string): Promise<LiveVoice>;
    /** Opens a session from this app's WebRTC offer: OpenAI's answer comes back. */
    startSession(orgId: string, input: LiveSessionInput): Promise<LiveSession>;
    endSession(orgId: string, sessionId: string): Promise<void>;
    channelRoom(orgId: string, channelId: string): Promise<{ room: LiveRoom | null }>;
    joinRoom(
      orgId: string,
      channelId: string,
      agentIds: string[],
      options?: { topic?: string | null; language?: string; phone?: boolean },
    ): Promise<LiveRoom>;
    /** The workspace's notes on how its agents behave on calls (§11). */
    saveCallNotes(orgId: string, notes: string): Promise<LiveVoice>;
    /** Calls people into the call (added to the conversation when needed, mentioned there, rung). */
    invite(
      orgId: string,
      roomId: string,
      userIds: string[],
      language?: string | null,
    ): Promise<{ invited: string[]; refused: string[] }>;
    ping(orgId: string, roomId: string): Promise<LiveRoom>;
    leave(orgId: string, roomId: string): Promise<void>;
    end(orgId: string, roomId: string): Promise<{ room: LiveRoom | null }>;
    signal(orgId: string, roomId: string, to: string, data: Record<string, unknown>): Promise<void>;
    lines(
      orgId: string,
      roomId: string,
      lines: { who: { type: "person" | "agent"; id: string }; text: string }[],
    ): Promise<void>;
    floor(orgId: string, roomId: string, holder: string | null, reason: string): Promise<void>;
    /** Which agent speaks next, and when (ADR doug-0006): after a person, after an agent, or while one talks. */
    next(orgId: string, roomId: string, ask?: LiveSpeakerAsk): Promise<LiveSpeakerPick>;
    /** An agent on the call took on work (it delegated): the agent works on it in the conversation during the call. */
    ask(
      orgId: string,
      roomId: string,
      input: { agentId: string; ask: string; delegationId: string },
    ): Promise<{ askId: string }>;
  };
  account: {
    authConfig(): Promise<AuthConfig>;
    /**
     * Whether the e-mail has an account and how it signs in (rate limited: `rate_limited` 429). `access`: the
     * early-access link's token, when the page has one. `humanCheck`: the bot check's token, when the server has one
     * (`human_check` 403 without it).
     */
    signInOptions(input: { email: string; access?: string }, humanCheck?: string): Promise<SignInOptions>;
    /** `null` when signed out. */
    me(): Promise<Me | null>;
    /** Unread and waiting in each workspace, in one call (`GET /me/unread`, ADR 0154); null signed out. */
    unread(): Promise<{ organizations: { orgId: string; unread: number; waiting: number }[] } | null>;
    /**
     * The accounts signed in on this browser, the current one first (`GET /device-accounts`, ADR 0183); empty on a
     * server from before it and with nobody signed in.
     */
    deviceAccounts(): Promise<DeviceAccount[]>;
    /** Moves this browser to another account signed in on it; every account stays signed in. */
    switchDeviceAccount(userId: string): Promise<void>;
    /**
     * Signs one account out of this browser, the current one without `userId`; the others stay. `signedIn`: the
     * browser still has an account, the next one when the current one left.
     */
    signOutDeviceAccount(userId?: string): Promise<{ signedIn: boolean }>;
    /** My app language (emails and pushes are written in it). */
    updateMe(input: { locale: AppLocale; auto?: boolean }): Promise<void>;
    /** My own area, asked once during the onboarding, or `skipped` (`PUT /me/work-area`). */
    setWorkArea(area: WorkAreaAnswer): Promise<void>;
    /** A one-time sign-in for the phone app, shown as a QR code. */
    phoneSignIn(): Promise<PhoneSignIn>;
    /**
     * A password for an account that has none, or a new one in place of its own (ADR 0158: every other session ends).
     * `reauth.sign_in` (403) without a sign-in in the last 10 minutes.
     */
    addPassword(password: string): Promise<void>;
    /** What deleting my account would close, leave and remove. */
    deletionPlan(): Promise<AccountDeletionPlan>;
    /**
     * Emails me the code that deleting my account takes (`reauth.code_wait` 429 with `retryIn` right after another,
     * `reauth.no_email` 409 on a server that sends none). `sole_owner` (409) while a workspace needs me.
     */
    deletionCode(): Promise<CodeSent>;
    /**
     * Deletes my account in 7 days, with the emailed `code`, or `password` on a server that sends none (ADR 0088 §10):
     * every session ends now. `sole_owner` (409) while a workspace needs me.
     */
    delete(input?: DeletionProofInput): Promise<void>;
    /** Brings it back before its date. `account.not_restorable` (409) after. */
    restore(): Promise<void>;
    /**
     * My account under `newEmail` (ADR 0088 §2, addendum 2026-11-13): with the `code` emailed to my current address, or
     * a sign-in in the last 10 minutes, a link goes to it; without either, the code goes first (`code`), or for an
     * address I never confirmed `reauth.sign_in` (403). On a server that sends no email it changes at once.
     * `email.same` (400), `email.held` (409), `reauth.code_*` as deleting's.
     */
    changeEmail(input: { newEmail: string; code?: string }): Promise<EmailChange>;
    /**
     * "This wasn't me", from the page the notice to my old address links to: that address comes back and every
     * session ends. `email.undo_gone` (404), `email.undo_taken` (409).
     */
    undoEmailChange(token: string): Promise<{ email: string }>;
  };
  /** Where my pushes go: phones (ADR 0035) and browsers (ADR 0071). Per person, not per organization. */
  push: {
    /** The server's Web Push public key (base64url); `null` when this server has Web Push off (`web_push_off` 404). */
    webKey(): Promise<string | null>;
    /** Registers (or refreshes, or moves to me) a phone's token or a browser's subscription. Rate limited (429). */
    register(input: PushDeviceInput): Promise<void>;
    /**
     * Stops pushes to a phone's token or a browser's endpoint (only my own; anything else is a no-op). In the
     * body, not the path: an endpoint's encoded slashes don't survive every proxy.
     */
    unregister(token: string): Promise<void>;
    /**
     * Of these notification ids (at most 100), the ones no longer open and unread for me (read, done, snoozed or
     * gone): a browser closes the notifications it still shows for them (clear on read, ADR 0071).
     */
    stale(ids: string[]): Promise<string[]>;
  };
  orgs: {
    /**
     * `timezone`: the workspace's; `memberTimezone`: the owner's own in it; `finished`: its onboarding over at once.
     * The answer says where it opens (`rightHandId`) and carries `/me` as it is now; neither from an older server.
     */
    create(input: {
      name: string;
      context?: string;
      timezone?: string;
      memberTimezone?: string;
      finished?: true;
      /** Who it is for (ADR 0159); a team's when left out. */
      mode?: WorkspaceMode;
    }): Promise<{ organization: Organization; generalChannelId: string } & OpenedWorkspace>;
    /**
     * Its owner's progress in setting it up: the furthest step reached (it only moves forward), or `finished`, whose
     * answer says where it opens and carries `/me`. Null from a server that doesn't keep it.
     */
    saveOnboarding(
      orgId: string,
      input: { step: OnboardingStepId } | { finished: true; holdBrand?: boolean },
    ): Promise<({ step: OnboardingStepId; finished: boolean } & OpenedWorkspace) | null>;
    get(orgId: string): Promise<Organization>;
    update(orgId: string, input: { name?: string; context?: string }): Promise<void>;
    /** Owners: emails me the code that deleting this workspace takes (as `account.deletionCode`). */
    deletionCode(orgId: string): Promise<CodeSent>;
    /**
     * Owners: closes the workspace for everyone now and deletes it for good 7 days later (`dueAt`); already being
     * deleted, its date. Proof as `account.delete`'s; 429 after 3 deletions of it in a day.
     */
    deleteWorkspace(orgId: string, input?: DeletionProofInput): Promise<{ dueAt: string }>;
    /** Owners, before its date: it opens again. `org.not_restorable` (409) once the date passed. */
    restore(orgId: string): Promise<void>;
    /** My handle and time zone in this organization (`timezone: null` = the organization's). */
    updateMe(orgId: string, input: { handle?: string; timezone?: string | null }): Promise<Person>;
    /** Your availability (auto, busy, hidden) and what you are doing (ADR 0084). */
    setStatus(orgId: string, input: StatusInput): Promise<Person>;
    /** What opens when the app starts here, on every device (ADR 0108; `start.channel_unknown`). */
    setStart(orgId: string, input: { page: StartPage; channelId?: string | null }): Promise<StartChoice>;
    /** Whether I see what agents did under each reply here, on every device. */
    setShowActivity(orgId: string, show: boolean): Promise<boolean>;
    /** How agents talk to me here (ADR 0147), for every agent. */
    setAgentStyle(orgId: string, style: AgentStyle): Promise<AgentStyle>;
    setChatPrefs(orgId: string, patch: ChatPrefs): Promise<ChatPrefs>;
    /** Where I put the tools at the top of my sidebar here (only the ones I moved). */
    sidebarItems(orgId: string): Promise<SidebarItems>;
    /** Moves one tool (`null`: back on its default), my others as the server has them. Answers with every choice. */
    setSidebarItem(orgId: string, item: SidebarItem, place: SidebarPlace | null): Promise<SidebarItems>;
    /** Replaces my choices (`{}`: every tool back on its default). */
    setSidebarItems(orgId: string, items: SidebarItems): Promise<SidebarItems>;
    /** The sidebar's sections in my order here. */
    sidebarOrder(orgId: string): Promise<SidebarSection[]>;
    /** Saves my section order here (`null`: the default). */
    setSidebarOrder(orgId: string, order: SidebarSection[] | null): Promise<SidebarSection[]>;
    /** How I look at Tarefas here, on every device (the default until I change it). */
    issuesView(orgId: string): Promise<IssuesView>;
    /** Keeps how I look at Tarefas here; answers with what the server kept. */
    setIssuesView(orgId: string, view: IssuesView): Promise<IssuesView>;
    /** The sidebar's tools in my order here (every tool; its place says list or More). */
    sidebarToolOrder(orgId: string): Promise<SidebarItem[]>;
    /** Saves my order of the tools here (`null`: the default). */
    setSidebarToolOrder(orgId: string, order: SidebarItem[] | null): Promise<SidebarItem[]>;
    /** How my sidebar shows the agents, and what I pinned, here. */
    sidebarView(orgId: string): Promise<SidebarView>;
    /** Replaces my sidebar view here; answers with what the server kept. */
    setSidebarView(orgId: string, view: SidebarView): Promise<SidebarView>;
    /** My profile photo: a square image (JSON only: base64), already cropped. */
    /** `portrait`: the recipe of a portrait drawn in the app; it comes back on the address as a `#px=` fragment. */
    setAvatar(
      orgId: string,
      input: { imageBase64: string; contentType: string; portrait?: string },
    ): Promise<{ avatarUrl: string }>;
    removeAvatar(orgId: string): Promise<void>;
    /** The workspace logo (admins): a square image (JSON only: base64), already cropped. */
    setLogo(orgId: string, input: { imageBase64: string; contentType: string }): Promise<{ logo: string }>;
    removeLogo(orgId: string): Promise<void>;
    /**
     * A signed link that opens the workspace's plan and billing on the billing service (owners and admins; ADR
     * 0079). Navigate to it at once and keep it nowhere else: it lasts 5 minutes and opens once. `billing.off` 404
     * on a server without billing. `returnTo`: the page it was opened from, where the billing service sends the
     * person back. `plan`: the plan picked in the app (the billing service's key), whose Checkout it opens.
     */
    billingLink(
      orgId: string,
      from: BillingFrom,
      returnTo?: string,
      plan?: string,
    ): Promise<{ url: string; expiresAt: string }>;
    /** People, files and today's uploads against the workspace's limits (any member; ADR 0079). */
    limits(orgId: string): Promise<WorkspaceLimits>;
    members(orgId: string): Promise<Member[]>;
    /** Makes a member an owner or not (owners only). What anyone may do is their roles (`roles.setFor`). */
    /** `via`: the right hand's people card it came from (the audit's "via", ADR 0137 §4). */
    changeRole(orgId: string, userId: string, role: Role, via?: string): Promise<void>;
    /** What removing them (or leaving) does; refused as the removal would be. */
    removal(orgId: string, userId: string): Promise<RemovalPreview>;
    removeMember(orgId: string, userId: string, via?: string): Promise<void>;
    /**
     * A one-time new-password link for a member, on a server that sends no email (owners only, ADR 0158): it works
     * once, for an hour, and ends the earlier one. Refused (403) for oneself, the server's owner and someone in a
     * workspace the caller doesn't own; 409 `password_link.email` where the server emails the person their own.
     */
    passwordLink(orgId: string, userId: string): Promise<{ url: string; expiresAt: string }>;
    invitations(orgId: string): Promise<Invitation[]>;
    invite(
      orgId: string,
      input: { email: string; role?: Role; roleIds?: string[] },
    ): Promise<{ invitation: Invitation; url: string }>;
    revokeInvitation(orgId: string, invitationId: string): Promise<void>;
    /** `null` when invalid or expired. */
    previewInvitation(token: string): Promise<InvitationPreview | null>;
    /** An email invitation that no longer opens: accepted or expired (ADR 0090); null for any other token. */
    invitationState(token: string): Promise<InvitationState | null>;
    /** `mail`: the proof on its own email's link (ADR 0090); accepted with it, the address counts as confirmed. */
    acceptInvitation(token: string, mail?: string): Promise<{ orgId: string }>;
    settings(orgId: string): Promise<OrgSettings>;
    /** The workspace's brand ("Sua marca"), the tones to tap and whether the onboarding waits for it. */
    brand(
      orgId: string,
      locale?: string,
    ): Promise<{
      pending: boolean;
      brand: BrandView | null;
      skillId: string | null;
      tones: BrandToneWord[];
    }>;
    /** Saves the brand as the workspace skill "Marca <empresa>", in one go (who manages agents). */
    saveBrand(orgId: string, input: BrandInput): Promise<{ skillId: string; brand: BrandView; pending: boolean }>;
    updateSettings(
      orgId: string,
      input: Partial<Omit<OrgSettings, "name" | "autoModels" | ReadOnlyOrgSettings>> & {
        name?: string;
        /** Per provider and tier, one of its models; null puts the tier back on its default. */
        autoModels?: Partial<Record<string, Partial<Record<ModelTier, string | null>>>>;
      },
    ): Promise<OrgSettings>;
    /** The workspace's approvals level; `everyAgent` also clears every agent's own choice. */
    setApprovalsLevel(
      orgId: string,
      input: { level: ApprovalsLevel; everyAgent?: boolean },
    ): Promise<{ level: ApprovalsLevel; ownAgents: number }>;
    overview(orgId: string): Promise<OrgOverview>;
    /** Members with presence. */
    people(orgId: string): Promise<Person[]>;
    /** Invitations not accepted yet, pending or expired. */
    allInvitations(orgId: string): Promise<InvitationWithStatus[]>;
    inviteMany(orgId: string, input: InviteBatch): Promise<BatchInviteResult[]>;
    /** The same link (ADR 0090; a new one for an invitation sent before that), 7 more days. */
    resendInvitation(orgId: string, invitationId: string): Promise<{ url: string; expiresAt: string }>;
    /**
     * What a pending invitation gives (ADR 0090, 0184): its cargos, channels and agents, an omitted one kept. The same
     * link, nothing is sent.
     */
    updateInvitation(
      orgId: string,
      invitationId: string,
      change: { roleIds?: string[]; channelIds?: string[]; agentIds?: string[] },
    ): Promise<{ roleIds: string[]; channelIds: string[]; agentIds: string[] }>;
    usageReport(orgId: string, since?: string): Promise<UsageReport>;
    /** Every plan account by computer and the API per agent, this month (ADR 0063). */
    planUsage(orgId: string): Promise<OrgPlanUsage>;
    /** Uso › Pessoas (ADR 0141): each person's use, their limit and what they do now (`view_usage`). */
    peopleUsage(orgId: string, period?: { since?: string; until?: string }): Promise<PeopleUsage>;
    /** Where the CSV of `peopleUsage` downloads from, one row per person per day. */
    peopleUsageCsvUrl(orgId: string, period?: { since?: string; until?: string }): string;
    /** A person's month; one's own in percentages. */
    personUsage(orgId: string, userId: string, period?: { since?: string; until?: string }): Promise<PersonUsage>;
    personLimits(orgId: string): Promise<PersonLimits>;
    setPersonLimits(orgId: string, limits: PersonLimits): Promise<PersonLimits>;
    /** "Pedir mais": the caller asks who decides for more this month. */
    requestMoreUsage(orgId: string): Promise<{ requestedAt: string }>;
    raisePersonLimit(orgId: string, userId: string, limitUsd: number): Promise<void>;
    refuseMoreUsage(orgId: string, userId: string): Promise<void>;
    /** Lodi's weekly card (ADR 0137 §9): when mine comes, or that it is off. */
    teamWeek(orgId: string): Promise<LodiPrefs>;
    setTeamWeek(orgId: string, patch: LodiPrefsPatch | LegacyPrefsPatch): Promise<LodiPrefs>;
    /** A row of my weekly card applied as me (a routine, a message), or "Agora não". */
    actOnTeamWeek(orgId: string, messageId: string, act: TeamWeekAct): Promise<void>;
    /** The audit log, newest first (admins): agents' tool calls and people's changes. `before`: `next`. */
    audit(orgId: string, query?: AuditQuery & { before?: string; limit?: number }): Promise<AuditPage>;
  };
  /** A workspace's roles (ADR 0085): every member reads them; who may manage roles changes those below theirs. */
  roles: {
    list(orgId: string): Promise<OrgRoles>;
    create(orgId: string, input: RoleInput): Promise<{ id: string }>;
    update(orgId: string, roleId: string, patch: Partial<RoleInput>): Promise<void>;
    remove(orgId: string, roleId: string): Promise<void>;
    /** Every role but `everyone`, top first. */
    reorder(orgId: string, ids: string[]): Promise<void>;
    /**
     * A person's roles, exactly these. `mailLossSeen`: the mailboxes they were told agents lose (`mailLoss`); one
     * given since refuses it (409 `agent.mail_loss_changed`).
     */
    setFor(
      orgId: string,
      userId: string,
      roleIds: string[],
      via?: string,
      mailLossSeen?: string[],
    ): Promise<{ roleIds: string[] }>;
    /** "Quem pode…": who holds one row (a key, or `computers`), `everyone` and the roles at once; the roles after it. */
    setRow(orgId: string, row: string, holders: RowHolders): Promise<OrgRoles>;
    /** The mailboxes agents would lose if `userIds` got the role, taking nothing. */
    mailLoss(orgId: string, roleId: string, userIds: string[]): Promise<RoleMailLoss[]>;
  };
  /** Groups of agents (ADR 0083): everyone reads them, owners and admins change them; each change answers with all. */
  agentGroups: {
    list(orgId: string): Promise<AgentGroup[]>;
    /** After the other groups, with `agentIds` in it in that order (out of any group they were in). */
    create(
      orgId: string,
      input: { name: string; agentIds?: string[]; color?: string; icon?: string },
    ): Promise<AgentGroup[]>;
    /** Renames it, or moves it among the groups (`index`). */
    update(orgId: string, groupId: string, patch: AgentGroupPatch): Promise<AgentGroup[]>;
    /** Its agents go back to no group. */
    remove(orgId: string, groupId: string): Promise<AgentGroup[]>;
    /** Into a group at `index` among its agents (the end without one), or out of any (`groupId` null). */
    move(orgId: string, agentId: string, input: { groupId: string | null; index?: number }): Promise<AgentGroup[]>;
  };
  agents: {
    list(orgId: string): Promise<Agent[]>;
    /** Its month by account and day, and the account it thinks with now (ADR 0063). */
    planUsage(orgId: string, agentId: string): Promise<AgentPlanUsage>;
    /** The agents as a team: grouped by person, with who consulted whom in the last day. */
    team(orgId: string): Promise<Team>;
    /**
     * Responde a (ADR 0148 addendum): who each agent reports to, in order, all or none. Answers what they reported to
     * before: the same call with it is Desfazer.
     */
    setLines(orgId: string, changes: AgentLineChange[]): Promise<{ previous: AgentLineChange[] }>;
    /** The team map's drag (ADR 0148): the right hand's settings card in my DM with it; nothing changes yet. */
    proposeChannelMove(
      orgId: string,
      input: { agentId: string; fromChannelId: string | null; toChannelId: string; reason: string },
    ): Promise<{ channelId: string; messageId: string; rightHandId: string }>;
    create(orgId: string, input: AgentInput): Promise<Agent>;
    /**
     * Its real photo (`PUT …/organizations/{orgId}/agents/{agentId}/photo`): a form with the image in `file` (JPEG, PNG or WebP
     * up to 5 MB, already cropped square). Its owner or who manages agents. Answers the photo's address.
     */
    setAgentPhoto(orgId: string, agentId: string, body: FormData): Promise<{ photo: string }>;
    /** Back to its drawn look. */
    removeAgentPhoto(orgId: string, agentId: string): Promise<void>;
    /** An agent's proposal of a new agent, by its card's message (ADR 0081). */
    proposal(orgId: string, messageId: string): Promise<AgentProposal>;
    /**
     * "Criar" on the card: the agent as proposed, with each line the person may give it. With `test` ("Criar e
     * testar", ADR 0137) the clicker's DM with it opens (`testChannelId`), its `firstTask` in the composer, unsent.
     */
    createProposed(
      orgId: string,
      messageId: string,
      options?: { test?: boolean },
    ): Promise<{ agent: Agent; proposal: AgentProposal; ai: SuggestedAi["kind"]; testChannelId?: string | null }>;
    /** "Pedir a um admin" on a card the person it is for can't create (ADR 0137): to whoever may, once. */
    askProposal(orgId: string, messageId: string): Promise<AgentProposal>;
    /** The routine it came with, for the agent created from the review (once it is where it reports). */
    proposalRoutine(orgId: string, messageId: string): Promise<AgentProposal>;
    /** Says no to it (who may create agents): the card stays, marked denied. */
    denyProposal(orgId: string, messageId: string): Promise<AgentProposal>;
    /** "Criar o time" on the right hand's team card: everything at once, or nothing and the card's `error`. */
    createTeam(orgId: string, messageId: string): Promise<{ card: TeamProposalCard; noAi?: string[] }>;
    denyTeam(orgId: string, messageId: string): Promise<{ card: TeamProposalCard }>;
    /** "Desfazer" on the team's receipt, within a day. */
    undoTeam(orgId: string, messageId: string): Promise<{ card: TeamProposalCard }>;
    /** "Ajustar": one agent's draft on the open card. */
    adjustTeamAgent(
      orgId: string,
      messageId: string,
      handle: string,
      patch: Partial<Pick<TeamAgentDraft, "name" | "role" | "line" | "instructions" | "channel">> & {
        firstTask?: string;
      },
    ): Promise<{ card: TeamProposalCard }>;
    /** "Ver modelos de time": the templates in `locale`. */
    teamTemplates(orgId: string, locale?: string, withDoug?: boolean): Promise<TeamTemplate[]>;
    /** The Doug team apart (docs/adr/doug-0030-time-doug.md), or undefined from a server that doesn't have it. */
    dougTemplate(orgId: string, locale?: string): Promise<DougTeamTemplate | undefined>;
    /**
     * "Criar o time": the template's team, made at once; its card in the person's DM with the right hand. The Doug
     * team takes `handles` (every agent when absent; `members[].handle`), and answers with the agents that work on a
     * computer and whether the onboarding's brand step waits (docs/adr/doug-0030-time-doug.md).
     */
    applyTeamTemplate(
      orgId: string,
      templateId: string,
      locale?: string,
      handles?: readonly string[],
    ): Promise<{
      channelId: string;
      messageId: string;
      state: TeamProposalCard["state"];
      error: TeamProposalCard["error"] | null;
      needsComputer?: { agentId: string; handle: string; name: string }[];
      brandPending?: boolean;
    }>;
    /** Decides an agent's proposal of costly work nobody asked for (ADR 0131): its card's `signalId`. */
    decideCostly(orgId: string, signalId: string, decision: CostlyDecision): Promise<{ state: CostlyDecision }>;
    update(orgId: string, agentId: string, input: Partial<AgentInput>): Promise<Agent>;
    /** Confirms a step of a new agent's setup checklist (ADR 0155 §2): its owner or whoever manages agents. */
    confirmSetup(orgId: string, agentId: string, step: SetupStep): Promise<Agent>;
    /** The mailboxes saving `audience` would take from it (others gave them), taking nothing: ask before widening. */
    mailLoss(orgId: string, agentId: string, audience: AgentAudience): Promise<ForeignMailbox[]>;
    archive(orgId: string, agentId: string): Promise<void>;
    /** An archived agent back in the team (who manages agents); never a deleted one. */
    unarchive(orgId: string, agentId: string): Promise<void>;
    /** Deletes it for good (ADR 0082): owners and admins, archived or not. */
    purge(orgId: string, agentId: string): Promise<void>;
    /** Agents no longer in the team (archived or deleted), for the names and faces of what they left. */
    former(orgId: string): Promise<FormerAgent[]>;
    models(): Promise<{
      models: Model[];
      defaultModel: string;
      /** Absent on an older server. */
      planModels?: Partial<Record<string, readonly PlanModel[]>>;
    }>;
    credentials(orgId: string): Promise<Credential[]>;
    addCredential(
      orgId: string,
      input: {
        provider: string;
        label: string;
        apiKey: string;
        /** Anthropic: workspace id for keys not scoped to one. */
        workspaceId?: string | null;
        /** OpenAI: organization and project (expected; the backend is adding OpenAI). */
        organizationId?: string | null;
        projectId?: string | null;
        /** `custom` only: the endpoint's address, API and models (ADR 0146). */
        endpoint?: { style: EndpointStyle; baseURL: string; models: EndpointModel[] };
      },
    ): Promise<Credential & { checks?: EndpointCheck[] }>;
    /** What an endpoint lists before it is saved (admins): its address as stored, its models, or why none. */
    endpointModels(
      orgId: string,
      input: { style: EndpointStyle; baseURL: string; apiKey?: string },
    ): Promise<{ baseURL: string; models: { id: string; label?: string }[]; error?: string }>;
    /** Changes an endpoint's models and prices, then tests each again. */
    setEndpointModels(
      orgId: string,
      credentialId: string,
      models: EndpointModel[],
    ): Promise<{ models: EndpointModel[]; checks: EndpointCheck[] }>;
    /** Replaces the key, keeping the id (agents keep using it). */
    rotateCredential(
      orgId: string,
      credentialId: string,
      input: { apiKey: string; label?: string },
    ): Promise<Credential>;
    /**
     * Revokes, or deletes for good with `purge`: refused while it's a default or an agent uses it, unless `release`
     * says the person read what happens to them.
     */
    removeCredential(orgId: string, credentialId: string, purge?: boolean, release?: boolean): Promise<void>;
    /** The key becomes the workspace's default and its provider's: agents without an AI of their own think with it. */
    makeDefaultCredential(orgId: string, credentialId: string): Promise<Credential>;
    /** The other saved copies of this key fold into it: their agents, defaults and spend move to it, then they go. */
    removeCredentialCopies(orgId: string, credentialId: string): Promise<{ removed: number }>;
    /** One cheap real call with a stored key, before an agent is pointed at it. A refusal comes as on saving one. */
    checkCredential(orgId: string, credentialId: string): Promise<{ check: "ok" | "unchecked" }>;
    /** Whether this server offers the platform key (Cloud). */
    platformKeyAvailable(orgId: string): Promise<boolean>;
    /** Whether each agent has an AI to think with, and whether the organization has any (ADR 0061). */
    aiStatus(orgId: string): Promise<AiStatus>;
    /** Each agent's presence and what it says it is doing (ADR 0084). */
    statuses(orgId: string): Promise<AgentStatus[]>;
    /** What the agent picks up when its plan or budget is back, in order (ADR 0118). */
    usageQueue(orgId: string, agentId: string): Promise<UsageQueue>;
    /** "Don't run any": nothing waiting on its plan or budget runs (the agent's owner and admins). */
    cancelUsageQueue(orgId: string, agentId: string): Promise<{ canceled: number; skipped: number }>;
    /** The agent's ronda (ADR 9004). */
    ronda(orgId: string, agentId: string): Promise<Ronda>;
    /** Turns the agent's ronda on, changes when it passes, or switches it off (who manages agents, or its owner). */
    setRonda(
      orgId: string,
      agentId: string,
      schedule: RondaSchedule,
      timezone?: string,
      /** The API model its runs think with; null for the agent's own brain; absent keeps it (ADR 9004 §5). */
      model?: string | null,
    ): Promise<Ronda>;
    /** The team file / agent definitions behind a GitHub link, read by the backend (onboarding import; nothing saved). */
    importFromGithub(
      orgId: string,
      url: string,
    ): Promise<{
      files: { path: string; text: string }[];
      /** Files the link has that fit the import but not the limits (200 files, 8 MB): not read. */
      skipped?: string[];
    }>;
    detail(orgId: string, agentId: string): Promise<AgentDetail>;
    channels(orgId: string, agentId: string): Promise<AgentChannel[]>;
    setChannels(
      orgId: string,
      agentId: string,
      channels: { channelId: string; autoReply?: boolean }[],
    ): Promise<AgentChannel[]>;
    /** "Quem pensa": the API, Claude Code or Codex on its computer (its owner or an admin). */
    brain(orgId: string, agentId: string, scope?: BrainScope): Promise<AgentBrain>;
    setBrain(orgId: string, agentId: string, input: AgentBrainInput): Promise<AgentBrain>;
    /** "Quem pensa" for an agent still being created: the workspace's computers and what each offers (admins). */
    brainMachines(orgId: string): Promise<BrainMachine[]>;
    /**
     * "Usar em outros agentes": the setup on each agent, by its own rules, one result each in the order asked; with
     * `preview`, what each would do and nothing kept.
     */
    applySetup(
      orgId: string,
      input: { setup: AgentSetup; agentIds: string[]; preview?: boolean },
    ): Promise<AgentSetupResult[]>;
    /** What a new agent starts thinking with (whoever creates agents); null: "Automático" on the API. */
    newAgentSetup(orgId: string): Promise<NewAgentSetup | null>;
    runs(
      orgId: string,
      filter?: { agentId?: string; status?: string; before?: string; since?: string; limit?: number },
    ): Promise<Run[]>;
    run(orgId: string, runId: string): Promise<{ run: Run; steps: RunStep[] }>;
    /**
     * "Parar": stops a run (the person who started it, the agent's owner, admins). The agent is told, with `reason`
     * when given (ADR 0128). `chain`: what it asked of other agents stops with it, all the way down.
     */
    cancelRun(orgId: string, runId: string, reason?: string, chain?: boolean): Promise<void>;
    /** "Dizer por quê" after stopping a task (only who stopped it, once): the agent reads it. */
    stopReason?(orgId: string, runId: string, reason: string): Promise<void>;
    /**
     * "Continuar" under a reply a person stopped (same people as `cancelRun`): a new run picks up
     * where it stopped. 409 `run.not_continuable` (already continued, not stopped by a person) or
     * `run.agent_busy` (the agent already works in that conversation).
     */
    continueRun(orgId: string, runId: string): Promise<{ runId: string }>;
    /** Runs still active in a channel (reconciles the live rows); `null` while the server lacks the endpoint. */
    activeRuns(orgId: string, channelId: string): Promise<ActiveRun[] | null>;
    /** The questions agents asked other agents from a conversation, latest first; `[]` while the server lacks it. */
    consultations(orgId: string, channelId: string): Promise<RunConsultation[]>;
    /** One of those questions opened: what the two agents said for it (read only); `null` once it's gone. */
    consultation(orgId: string, channelId: string, consultationId: string): Promise<ConsultationConversation | null>;
    /** This month's usage per agent; `null` without the `view_usage` permission. */
    usage(orgId: string): Promise<AgentUsage[] | null>;
  };
  /** Bringing agents and what's around them from another app or another agentes.chat (ADR 0055); admins. */
  imports: {
    /** The plan of a bundle (`dryRun`), or the picked items applied: either way every item with its action. */
    apply(orgId: string, input: ImportInput): Promise<ImportPlan>;
    /** What this workspace brought from other apps, by source package (admins). */
    sources(orgId: string): Promise<ImportedSource[]>;
    /**
     * One of an imported agent's files into its folder in the Drive (multipart, ≤ 50 MB). A name already in the
     * folder is never overwritten (`exists`); a credential store is refused (`import.secret_file`).
     */
    copyFile(orgId: string, input: ImportFileInput): Promise<ImportedFile>;
    /** Same-origin URL that downloads this workspace as a bundle (`.json`). */
    exportUrl(orgId: string): string;
  };
  chat: {
    channels(orgId: string): Promise<Channel[]>;
    createChannel(orgId: string, input: ChannelInput & { name: string; categoryId?: string | null }): Promise<Channel>;
    /** The sidebar's categories, in order (ADR 0080). */
    categories(orgId: string): Promise<ChannelCategory[]>;
    /** Admins: a category at the end, optionally taking `channelIds` along. */
    createCategory(orgId: string, input: { name: string; channelIds?: string[] }): Promise<ChannelCategory>;
    renameCategory(orgId: string, categoryId: string, name: string): Promise<ChannelCategory>;
    /** Its channels go on top, with no category. */
    deleteCategory(orgId: string, categoryId: string): Promise<void>;
    /** Before `beforeCategoryId`, or to the end (null). */
    placeCategory(orgId: string, categoryId: string, beforeCategoryId: string | null): Promise<void>;
    /** Into `categoryId` (null: none), before `beforeChannelId` or at the end. */
    place(
      orgId: string,
      channelId: string,
      input: { categoryId: string | null; beforeChannelId?: string | null },
    ): Promise<void>;
    join(orgId: string, channelId: string): Promise<void>;
    /** Out of a channel I'm in. The last person out of a private channel archives it. Never #general. */
    leave(orgId: string, channelId: string): Promise<void>;
    /** A `#channel` link's card; 404 for a channel I can't see (private and not mine). Archived ones too. */
    card(orgId: string, channelId: string): Promise<ChannelCard>;
    /** A pasted message link's pill; 404 for a message I can't see (a private channel's, a DM I'm not in). */
    messageCard(orgId: string, messageId: string): Promise<MessageCard>;
    /** What an internal id in a text names, as its pill; 404 for anything I can't see or that isn't ours. */
    idRef(orgId: string, id: string): Promise<IdRef>;
    update(orgId: string, channelId: string, input: ChannelInput & { name?: string }): Promise<Channel>;
    /** The channel's photo (whoever may rename it): a square image (JSON only: base64), already cropped. */
    setIcon(
      orgId: string,
      channelId: string,
      input: { imageBase64: string; contentType: string },
    ): Promise<{ icon: string }>;
    removeIcon(orgId: string, channelId: string): Promise<void>;
    /** Creator or admin: the channel leaves everyone's list (its messages are kept). */
    archive(orgId: string, channelId: string): Promise<void>;
    /** An archived channel back as it was (its creator or who manages channels). */
    unarchive(orgId: string, channelId: string): Promise<void>;
    /** The archived channels the viewer may bring back, the latest first. */
    archived(orgId: string): Promise<ArchivedChannel[]>;
    /** Owners and admins, never #general: the channel and what it held go for good. `name`: typed to confirm. */
    deleteChannel(orgId: string, channelId: string, name: string): Promise<void>;
    /** Members with names; agents carry `autoReply`. */
    roster(orgId: string, channelId: string): Promise<RosterMember[]>;
    members(orgId: string, channelId: string): Promise<ChannelMember[]>;
    addMember(orgId: string, channelId: string, member: { userId: string } | { agentId: string }): Promise<void>;
    removeMember(orgId: string, channelId: string, member: { userId: string } | { agentId: string }): Promise<void>;
    /** "Quando responde" for an agent in this channel (its creator, an admin or the agent's owner). */
    setAutoReply(orgId: string, channelId: string, agentId: string, autoReply: boolean): Promise<void>;
    /** The channel's exceptions (ADR 0134), for who manages it. */
    permissions(orgId: string, channelId: string): Promise<ChannelOverride[]>;
    /** Sets one exception; empty `allow` and `deny` remove it (null). */
    setPermission(orgId: string, channelId: string, override: ChannelOverride): Promise<ChannelOverride | null>;
    messages(
      orgId: string,
      channelId: string,
      options?: { threadId?: string; before?: string; limit?: number },
    ): Promise<Message[]>;
    post(
      orgId: string,
      channelId: string,
      input: {
        body: string;
        threadId?: string | null;
        clientId?: string;
        /** Quote reply: the message this one answers (the server stores `meta.replyTo`). */
        replyTo?: string;
        /** Uploaded files (artifact ids): the server stores `meta.artifacts`. */
        attachments?: string[];
        /** Sent from the thread panel ("Responder"), with `threadId`: the thread gets `openedByReplyAt`. */
        openThread?: boolean;
        /** "Parar e mandar": an agent working here stops its current step and reads this now. */
        steer?: "now";
        /**
         * A GIF or a sticker (ADR 0091): `body` may then be empty. The server stores `meta.media`. 422
         * `message.media_off` (GIFs or stickers off here) or `message.media_not_found`.
         */
        media?: PostMedia;
      },
    ): Promise<Message>;
    reactions(orgId: string, messageId: string): Promise<ReactionCount[]>;
    react(orgId: string, messageId: string, reaction: string): Promise<ReactionCount[]>;
    unreact(orgId: string, messageId: string, reaction: string): Promise<ReactionCount[]>;
    /** Corrects an agent's reply: it becomes a lesson for that agent. */
    correct(orgId: string, messageId: string, body: string): Promise<void>;
    /**
     * "Responder agora" once an AI is connected: the agent answers what it couldn't. `messageId` is its
     * no-AI card or the person's message. 409 `ai.still_missing` while there's still no AI.
     */
    answerNow(orgId: string, messageId: string): Promise<{ runs: { agentId: string; runId: string }[] }>;
    /** The returns agents set in a conversation, still to come, the soonest first (`[]` while the server lacks it). */
    followUps(orgId: string, channelId: string): Promise<PendingReturn[]>;
    /**
     * Cancels a return (`messageId`, its line): the person it is for, the agent's owner or an admin (403
     * `follow_up.not_yours` otherwise); 409 `follow_up.not_pending` once it came.
     */
    cancelFollowUp(orgId: string, messageId: string): Promise<void>;
    /**
     * "Pedir resposta" on a GitHub notice of someone the agent doesn't answer (`messageId`): the agent answers them
     * there, with this person behind it. 409 `github_event.answered` once someone asked.
     */
    answerGitHub(orgId: string, messageId: string): Promise<void>;
  };

  approvals: {
    list(
      orgId: string,
      filter?: { status?: "pending" | "decided"; agentId?: string; messageId?: string },
    ): Promise<Approval[]>;
    get(orgId: string, approvalId: string): Promise<Approval>;
    /** `always`: also approve this kind for good (409 `approval.always_unavailable` where it isn't offered). */
    /** `via`: the right hand's approvals card it was decided from (the audit's "via", ADR 0137 §4). */
    approve(orgId: string, approvalId: string, reason?: string, always?: boolean, via?: string): Promise<Approval>;
    refuse(orgId: string, approvalId: string, reason?: string, via?: string): Promise<Approval>;
    /** Withdraws an action approved ahead before its time: its routine's run won't do it. */
    cancel(orgId: string, approvalId: string): Promise<Approval>;
    /**
     * A card's "Aprovar tudo" / "Agora não para todos": exactly these ids; `skipped` the ones not decided. With
     * `only: "routine"` the server decides the ones it calls routine (`Approval.routine`) and skips the rest.
     */
    decideMany(
      orgId: string,
      input: { ids: string[]; decision: "approve" | "refuse"; reason?: string; via?: string; only?: "routine" },
    ): Promise<{ approvals: Approval[]; skipped: string[] }>;
    /** What the agent runs without asking ("Aprovar sempre"), oldest first. */
    rules(orgId: string, agentId: string): Promise<ApprovalRule[]>;
    /** The agent asks again for that kind (admins and the agent's owner). */
    removeRule(orgId: string, agentId: string, ruleId: string): Promise<void>;
    /** Who approves for me, and whom I approve for (ADR 0139). */
    covers(orgId: string): Promise<ApprovalCovers>;
    setCover(orgId: string, input: ApprovalCoverInput): Promise<ApprovalCovers>;
    /** Ends `userId`'s cover: mine, the one I give them ("Não quero cobrir"), or any as an admin. */
    endCover(orgId: string, userId: string): Promise<void>;
    /** What the right hand may approve for me (ADR 0139 §2). */
    rightHand(orgId: string): Promise<RightHandApprovals>;
    setRightHand(orgId: string, input: RightHandApprovalsInput): Promise<RightHandApprovals>;
    /** Desfazer, for 24 hours: a new agent is archived, settings go back. */
    undoRightHand(orgId: string, decisionId: string): Promise<void>;
  };
  connectors: {
    /** Connectors agentes.chat knows, with their scopes, plus the built-in scopes. */
    catalog(): Promise<ConnectorCatalog>;
    /** The organization's connections (no secrets). */
    list(orgId: string): Promise<Connection[]>;
    connectWithKey(orgId: string, input: { connector: string; apiKey: string; label?: string }): Promise<Connection>;
    /** Returns the provider URL to open; the server redirects back to `returnTo`. */
    startOAuth(orgId: string, connector: string, input: { returnTo: string }): Promise<string>;
    /** The workspace's Composio calls this month and its cap (any member). */
    composioUsage(orgId: string): Promise<ComposioUsage>;
    /**
     * The phone app (`returnTo: APP_OAUTH_RETURN`) or the desktop app's window (`desktop:` + a path) finishes an
     * authorization it started with the `state` and `code` the callback handed back to it. `returnTo`: the path
     * a desktop authorization lands on.
     */
    completeOAuth(
      orgId: string,
      input: { state: string; code: string },
    ): Promise<{
      connectionId: string;
      connector: string;
      /** Absent from an older server. */
      outcome?: ConnectOutcome;
      returnTo?: string;
    }>;
    /** Renames a connection, any kind (admins); its tools keep their names. 409 `connector.label_taken`. */
    rename(orgId: string, connectionId: string, label: string): Promise<Connection>;
    disconnect(orgId: string, connectionId: string): Promise<void>;
  };
  /** Connections and agents from the person's other workspaces. */
  carry: {
    /** Their other workspaces with something to bring into this one. */
    sources(orgId: string): Promise<CarrySource[]>;
    /** Brings them: an agent's own connections come with it. */
    bring(
      orgId: string,
      input: { connectionIds?: string[]; agentIds?: string[]; credentialIds?: string[] },
    ): Promise<CarryResult>;
    /** The same agent in the person's other workspaces, trained as one (ADR doug-0013). */
    twins(orgId: string, agentId: string): Promise<AgentTwins>;
    /** Joins it with its copy `otherAgentId` in another workspace. */
    joinTwin(orgId: string, agentId: string, otherAgentId: string): Promise<AgentTwins>;
    /** Takes this copy out: trained here alone from now on. */
    leaveTwin(orgId: string, agentId: string): Promise<AgentTwins>;
  };
  githubApp: {
    /** Whether this server can install the GitHub App, the organization's installations, and the server's app. */
    info(orgId: string): Promise<GitHubAppInfo>;
    /** Returns GitHub's install URL; GitHub sends the person back to `returnTo` (`APP_OAUTH_RETURN` from the phone). */
    install(orgId: string, returnTo: string): Promise<string>;
    /** Finishes an install the phone started, with what GitHub handed back to the app. */
    complete(
      orgId: string,
      input: { state: string; code: string; installationId: number },
    ): Promise<{ installation: GitHubAppInstallation }>;
    /** Unbinds an installation and uninstalls the app from that GitHub account; `uninstalled` false: GitHub didn't. */
    remove(orgId: string, id: string): Promise<{ uninstalled: boolean }>;
    /** The server's owner: this server's page that sends the manifest to GitHub, to open. */
    startManifest(returnTo: string): Promise<string>;
    /** The server's owner: removes the app made from Settings. */
    removeSettings(): Promise<GitHubAppSetup>;
    /** Repositories the organization's GitHub reaches, by account. */
    repositories(orgId: string): Promise<GitHubRepositories>;
    /** The organizations the GitHub connection reaches now, and GitHub's page to grant more (admins). */
    access(orgId: string): Promise<GitHubOrgAccess>;
  };
  search: {
    query(
      orgId: string,
      input: { q: string; kinds?: SearchKind[]; limit?: number; filters?: SearchFilterInput },
    ): Promise<SearchHit[]>;
  };
  sandbox: {
    settings(orgId: string): Promise<SandboxSettings>;
    saveSettings(orgId: string, input: SandboxSettingsInput): Promise<SandboxSettings>;
    /** Which computer the agent uses. */
    computer(orgId: string, agentId: string): Promise<AgentComputer>;
    /** Which computer the agent uses: a connected machine, or `null` for none. */
    setTarget(orgId: string, agentId: string, machineId: string | null): Promise<ComputerTarget>;
  };
  /** Bring your own devices: computers people connect and the phones they reach, as agents' targets. */
  devices: {
    list(orgId: string): Promise<DevicesList>;
    updateComputer(orgId: string, machineId: string, input: ComputerDeviceInput): Promise<ComputerDevice>;
    removeComputer(orgId: string, machineId: string): Promise<void>;
    updatePhone(orgId: string, phoneId: string, input: PhoneDeviceInput): Promise<PhoneDevice>;
    /** Forgets it; it comes back if its host sees it again. */
    forgetPhone(orgId: string, phoneId: string): Promise<void>;
    /** Takes the phone back from the agent using it. */
    stopPhone(orgId: string, phoneId: string): Promise<void>;
    createLink(orgId: string, kind: "server" | "computer"): Promise<ConnectLink>;
    link(orgId: string, linkId: string): Promise<ConnectLinkState>;
    approveRequest(
      orgId: string,
      requestId: string,
      input: { name?: string; audience?: DeviceAudience },
    ): Promise<{ machineId: string }>;
    denyRequest(orgId: string, requestId: string): Promise<void>;
    decideAccess(orgId: string, requestId: string, decision: "once" | "always" | "no"): Promise<void>;
    deviceWait(orgId: string, runId: string, action: "retry" | "stop"): Promise<void>;
    /** Pairs an Android phone with the computer over Wi-Fi: the QR way, or the six-digit `code` and its `address`. */
    startWifiPairing(
      orgId: string,
      machineId: string,
      input: { address?: string; code?: string },
    ): Promise<WifiPairing>;
    wifiPairing(orgId: string, machineId: string, pairingId: string): Promise<WifiPairing>;
    cancelWifiPairing(orgId: string, machineId: string, pairingId: string): Promise<void>;
    /**
     * Asks the computer to also look for a plugged phone it has no driver for, which adb never lists (Windows), or a
     * Mac to read its iPhones again now (answered once the new list is in).
     */
    lookForPhones(orgId: string, machineId: string): Promise<void>;
    /** The iPhones on this Mac's Wi-Fi that trust it and aren't used yet (its owner or an admin). */
    wifiIphones(orgId: string, machineId: string): Promise<WifiIphones>;
    /** Uses that iPhone over Wi-Fi from now on; forgetting the phone stops it. */
    pickIphoneOverWifi(orgId: string, machineId: string, serial: string): Promise<WifiIphones>;
    /** Fixes the Mac's Xcode (its owner or an admin); `select` asks for the Mac's password on the Mac. */
    startXcodeFix(orgId: string, machineId: string, kind: "select" | "update"): Promise<XcodeFixView>;
    xcodeFix(orgId: string, machineId: string): Promise<XcodeFixView>;
    cancelXcodeFix(orgId: string, machineId: string): Promise<XcodeFixView>;
    /** Opens Xcode on the Mac (its owner or an admin): it shows Developer Mode on a plugged iPhone. */
    openXcode(orgId: string, machineId: string): Promise<{ opened: boolean }>;
  };
  /** Connected computers (ADR 0025): machines running `agentes-runner`. */
  machines: {
    list(orgId: string): Promise<Machine[]>;
    rename(orgId: string, machineId: string, name: string): Promise<{ id: string; name: string }>;
    /** Revokes its token and disconnects the runner at once; agents on it are left with no computer. */
    remove(orgId: string, machineId: string): Promise<void>;
    /** The server's own computer in this organization; null when the server has none or doesn't serve it. */
    host(orgId: string): Promise<HostComputer | null>;
    /** Uses the server's computer again (admins); `remove` is how it stops. */
    hostOn(orgId: string): Promise<HostComputer>;
    /** ADR 0056 §10: whether the workspace gets its own computer, and how far it is (every member). */
    computerSetup(orgId: string): Promise<ComputerSetup>;
    /**
     * ADR 0036 §5, the device flow: the computer made the code; the person sees it here
     * (`machine.device_not_found` once expired, used or unknown).
     */
    device(userCode: string): Promise<DeviceRequest>;
    /** Connects it to the organization (201, the new machine). */
    confirmDevice(orgId: string, userCode: string, input: { name?: string }): Promise<Machine>;
    /** "Não fui eu": the computer gets `access_denied`. */
    denyDevice(userCode: string): Promise<void>;
    /** ADR 0036 §8: the site only takes away (a folder, for everyone or one agent; a tool). The new access. */
    reduceAccess(orgId: string, machineId: string, input: MachineAccessReduce): Promise<MachineAccess>;
    /** Only the person who paired it: turns `tool` on there (the computer says so, with Undo). The new access. */
    allowTool(orgId: string, machineId: string, tool: MachineTool): Promise<MachineAccess>;
    /** Anyone else: asks whoever paired it to turn `tool` on (an inbox row with the same button). */
    askTool(orgId: string, machineId: string, tool: MachineTool): Promise<void>;
    /** Its PATH read again and its coding CLIs looked for now ("Já instalei, verificar de novo"). */
    checkClis(orgId: string, machineId: string): Promise<void>;
    /** Only the person who paired it: installs `tool` there, or where that install stands, or stops it. */
    cliInstall(
      orgId: string,
      machineId: string,
      tool: InstallableCli,
      action: "start" | "status" | "cancel",
    ): Promise<{ install: CliInstall | null }>;
    /** Anyone else: asks whoever paired it to install `tool` (an inbox row with the install button). */
    askCliInstall(orgId: string, machineId: string, tool: InstallableCli): Promise<void>;
    /** Pauses it (`until` null: until resumed) or resumes it (`resume`); the pause as it stands then. */
    setPause(
      orgId: string,
      machineId: string,
      input: { until: string | null } | "resume",
    ): Promise<MachinePause | null>;
    /** ADR 0036 §9: the newest desktop app build; `null` when there is none (404). */
    desktopLatest(target: string, arch: string): Promise<DesktopRelease | null>;
    /** Offline computers that agents wait for, and where they could move. */
    outages(orgId: string): Promise<MachineOutages>;
    /** A computer's line: the turns working on it and the runs waiting for room, in order. */
    queue(orgId: string, machineId: string): Promise<ComputerQueue>;
    /** Moves waiting agents off an offline computer (their waiting runs follow where they can). */
    moveAgents(orgId: string, machineId: string, input: MoveAgentsInput): Promise<MoveAgentsResult>;
    /**
     * ADR 0041 §2: the computer starts the provider's own sign-in. `accountId`: sign in again to that account
     * of the viewer's; `email` (Claude): which account, as the CLI's hint; `provider`: a coding plan's key.
     */
    beginAccountLogin(
      orgId: string,
      machineId: string,
      kind: MachineAccountKind,
      options?: { accountId?: string; email?: string; provider?: string },
    ): Promise<AccountLoginStart>;
    /** Claude Code: the code Claude showed (or a plan's key), sealed in the browser to the computer's key (`sealSecret`). */
    sendAccountCode(orgId: string, machineId: string, loginId: string, box: SecretBox): Promise<void>;
    accountLogin(orgId: string, machineId: string, loginId: string): Promise<AccountLoginStatus>;
    /** Gives up on a sign-in (Voltar, the dialog closed): the computer stops it. */
    cancelAccountLogin(orgId: string, machineId: string, loginId: string): Promise<void>;
    /** An accounts screen opened: the viewer's plans look their usage up again (it arrives as `machine.updated`). */
    refreshAccountUsage(orgId: string): Promise<void>;
    /** "Contas de IA": the viewer's accounts on every computer, and where they can add one. */
    aiAccounts(orgId: string): Promise<AiAccounts>;
    /**
     * "Tirar de volta" (ADR 0059 §3): the viewer's plan leaves an agent someone else gave it to (`agentId`), or every
     * such agent.
     */
    takeBackPlan(orgId: string, accountId: string, agentId?: string): Promise<{ agentIds: string[] }>;
    /** Who the viewer's plan thinks for (ADR 0059 §3): everyone in the workspace, or only them. */
    setAccountServes(
      orgId: string,
      accountId: string,
      serves: PlanServes,
    ): Promise<{ serves: PlanServes; agentIds: string[] }>;
    /** The viewer's accounts that think, in this order, when an agent's account reaches 90% (ADR doug-0003). */
    setStandInOrder(orgId: string, accountIds: string[]): Promise<{ accountIds: string[] }>;
    /** Its owner names it (1 to 40 characters). */
    renameAccount(orgId: string, machineId: string, accountId: string, label: string): Promise<MachineAccount>;
    /** Its owner (or whoever connected the computer) disconnects it; the computer signs it out and deletes it. */
    removeAccount(orgId: string, machineId: string, accountId: string): Promise<void>;
  };
  skills: {
    /** The org library. */
    list(orgId: string): Promise<Skill[]>;
    get(orgId: string, id: string): Promise<SkillDetail>;
    /** "Escrever". */
    create(orgId: string, input: SkillInput): Promise<SkillDetail>;
    /**
     * A GitHub link (a skill's folder or a file in it) or the folder as a zip in base64 (writes are JSON only). A link
     * holding several skills (or any, with `list`) installs nothing and answers with them to pick from
     * (`importPicked`), those that can't be installed apart. A private repository is read through the workspace's
     * GitHub, on the server. `forAgentId`: the agent whose card opened the install, which gets what installs turned on
     * when the installer may change its skills. `personal`: the person's own skill, which any member installs (from a
     * public repository unless they manage agents). `upload`: a zip's Cancel and how much of it has been sent.
     */
    import(
      orgId: string,
      input: (
        | { url: string; list?: boolean; forAgentId?: string }
        | { zipBase64: string }
        | { artifactId: string; forAgentId?: string }
      ) & { personal?: boolean },
      upload?: UploadOptions,
    ): Promise<SkillDetail | SkillPick>;
    /** Installs the skills picked among a link's choices (their `path`), on for `forAgentId` as `import` does. */
    importPicked(
      orgId: string,
      url: string,
      paths: string[],
      forAgentId?: string,
      personal?: boolean,
    ): Promise<SkillDetail[]>;
    update(orgId: string, id: string, patch: SkillPatch): Promise<SkillDetail>;
    /** Fetch the link again (`url` skills). */
    reimport(orgId: string, id: string): Promise<SkillDetail>;
    remove(orgId: string, id: string): Promise<void>;
    /** Every library skill with `enabled` for this agent. */
    forAgent(orgId: string, agentId: string): Promise<AgentSkill[]>;
    setForAgent(orgId: string, agentId: string, skills: { skillId: string; enabled: boolean }[]): Promise<AgentSkill[]>;
    /** Skills the agent made from its own how-tos, archived ones too (older servers: absent). */
    learned?(orgId: string, agentId: string): Promise<LearnedSkill[]>;
    /** Undo the agent's last change to its own skill. */
    revert?(orgId: string, id: string): Promise<SkillDetail>;
    /** Update it from its link: new text applies (undoable), files that run wait (older servers: absent). */
    updateFromSource?(orgId: string, id: string): Promise<SkillSourceUpdate>;
    /** Apply the waiting update as it was shown; if its link changed since, it waits again. */
    approveUpdate?(orgId: string, id: string): Promise<SkillSourceUpdate>;
    /** Refuse the waiting update. */
    dismissUpdate?(orgId: string, id: string): Promise<SkillDetail>;
    /** Undo `dismissUpdate`: the update it kept out waits again. */
    reopenUpdate?(orgId: string, id: string): Promise<SkillDetail>;
    /** Back to the version before its last update from its link. */
    undoUpdate?(orgId: string, id: string): Promise<SkillDetail>;
    /** Bring back a skill archived for disuse. */
    restore?(orgId: string, id: string): Promise<SkillDetail>;
    /** The workspace's skill settings (older servers: absent). */
    settings?(orgId: string): Promise<SkillSettings>;
    saveSettings?(orgId: string, input: SkillSettings): Promise<SkillSettings>;
  };
  access: {
    /** The agent's tool tree with each node's state. 404 while the backend doesn't have it. */
    get(orgId: string, agentId: string): Promise<AgentAccess>;
    set(orgId: string, agentId: string, input: AccessInput): Promise<AgentAccess>;
  };
  /** The GitHub repositories an agent may use, in order (`owner/name` or `owner/*`); empty = every repository. */
  repositories: {
    get(orgId: string, agentId: string): Promise<string[]>;
    set(orgId: string, agentId: string, repositories: string[]): Promise<string[]>;
    /** Where it merges with no approval card (`owner/name`). */
    merge(orgId: string, agentId: string): Promise<string[]>;
    setMerge(orgId: string, agentId: string, repositories: string[]): Promise<string[]>;
  };
  scopes: {
    get(orgId: string, agentId: string): Promise<ScopeGrant[]>;
    set(orgId: string, agentId: string, grants: ScopeGrant[]): Promise<ScopeGrant[]>;
  };

  memory: {
    /** `about: "me"`: only what came from the viewer, each with `from` (the message). */
    list(orgId: string, agentId: string, filter?: { about?: "me" }): Promise<Memory[]>;
    listAll(orgId: string): Promise<Memory[]>;
    /** Memória do time (ADR 0167): what people asked every agent to keep. */
    listTeam(orgId: string): Promise<Memory[]>;
    /** Tornar do time (ADR 0167): an agent's memory becomes the team's; its copies are archived. */
    makeTeam(orgId: string, memoryId: string): Promise<Memory>;
    edit(orgId: string, memoryId: string, text: string): Promise<Memory>;
    setPinned(orgId: string, memoryId: string, pinned: boolean): Promise<Memory>;
    setArchived(orgId: string, memoryId: string, archived: boolean): Promise<Memory>;
    /** Confirmar (ADR 0167): trusted and verified, by who may edit it or the person who said it. */
    confirm(orgId: string, memoryId: string): Promise<Memory>;
    /** Undoes a change the agent made from the chat (`update.undo.path`). */
    revert(orgId: string, memoryId: string): Promise<void>;
  };
  proposals: {
    /** The newest 200, pending ones first; with `ids`, only those (a chat card's rows). */
    list(orgId: string, filter?: { ids?: string[] }): Promise<Proposal[]>;
    accept(orgId: string, proposalId: string, finalText?: string): Promise<Proposal>;
    refuse(orgId: string, proposalId: string): Promise<Proposal>;
    /** "Pedir a um admin" (ADR 0137): the person who asked sends a row they can't decide to whoever may, once. */
    ask(orgId: string, proposalId: string): Promise<Proposal>;
  };
  customConnectors: {
    list(orgId: string): Promise<CustomServer[]>;
    /**
     * Connects to an https MCP server: a new account, or with `connectionId` a new sign-in for that one
     * ("Reconectar"). Without `apiKey` the server tries OAuth (discovery + dynamic client registration); if the
     * MCP server doesn't support it, answers `needs_key` (`reason: "not_approved"` when it only registers apps it
     * approved, with its refusal in `detail`). `headers` go with every request to the server (at most 10; a refused
     * one is a 400 `connector.header_*` whose params name it, `header` and `index`). Without a key, a server that
     * answers with them is connected by them alone; one that asks for a sign-in is refused
     * (`connector.headers_with_sign_in`). With `connectionId`: absent keeps the account's (a 400
     * `connector.headers_unreadable` when they can no longer be read), `[]` removes them, a list replaces them.
     */
    connect(
      orgId: string,
      input: {
        serverUrl: string;
        apiKey?: string;
        label?: string;
        returnTo: string;
        connectionId?: string;
        headers?: RequestHeader[];
      },
    ): Promise<CustomConnectStart>;
    /** Lists the server's tools again; new ones come back unclassified. */
    refresh(orgId: string, serverId: string): Promise<CustomServer>;
    /** Saves the classification; only classified tools become available to agents. */
    saveTools(
      orgId: string,
      serverId: string,
      input: { label: string; tools: { name: string; access: ToolDecision; label: string; confirmed?: boolean }[] },
    ): Promise<CustomServer>;
    disconnect(orgId: string, serverId: string): Promise<void>;
  };
  dms: {
    /** My direct conversations, with unread counts. */
    list(orgId: string): Promise<DirectMessage[]>;
    /**
     * The DM channel with a person or an agent, created on first use; `dm`: it as the list has it (none from an older
     * server, or while it isn't in the list yet).
     */
    open(orgId: string, target: DmTarget): Promise<{ channelId: string; dm?: DirectMessage }>;
    /** Marks a channel or DM read up to now. */
    markRead(orgId: string, channelId: string): Promise<void>;
    /** Where the other people of a DM stopped reading ("Visto"); empty for any other channel. */
    reads(orgId: string, channelId: string): Promise<DmRead[]>;
  };
  questions: {
    /** Answers an agent's question with a choice or free text. */
    answer(orgId: string, questionId: string, input: { choice?: string; text?: string }): Promise<AgentQuestion>;
    /** Skips it: the agent goes on without an answer. */
    dismiss(orgId: string, questionId: string): Promise<AgentQuestion>;
  };
  /** Secrets agents ask for (ADR 0027): only the person asked answers; the value goes sealed. */
  secrets: {
    /** The request as it stands now (only the person asked): what a refused answer reads to end its card. */
    get(orgId: string, requestId: string): Promise<SecretRequest>;
    deliver(orgId: string, requestId: string, box: SecretBox): Promise<SecretRequest>;
    decline(orgId: string, requestId: string): Promise<SecretRequest>;
    /** Names on the agent's computers (its owner or an admin). */
    list(orgId: string, agentId: string): Promise<AgentSecret[]>;
    remove(orgId: string, agentId: string, name: string, machineId: string | null): Promise<void>;
    /**
     * "Save to the Vault" on the card (ADR 0144), after `deliver`: a site's password as a login, a variable as a
     * key. Only the person asked; 409 `vault.request_not_delivered`, 400 `vault.request_not_savable` (a file or a
     * code), 403 `vault.team_needs_permission`. Optional so older fakes type-check.
     */
    saveToVault?(orgId: string, requestId: string, input: SecretToVaultInput): Promise<VaultItem>;
  };
  issues: {
    /**
     * What each person and agent has to do from `from` (the asker's today) through `days`, and what is late. Owners
     * and admins only. Optional so older fakes type-check.
     */
    agenda?(orgId: string, query: { from: string; days?: number }): Promise<TeamAgenda>;
    /** `projectId`: only that project's tasks, or `none` for the ones with no project. */
    list(orgId: string, filters?: { q?: string; projectId?: string }): Promise<Issue[]>;
    get(orgId: string, number: number): Promise<Issue>;
    create(orgId: string, input: IssueInput): Promise<Issue>;
    update(orgId: string, id: string, patch: IssuePatch): Promise<Issue>;
    /** For good, with its steps and its conversation; what an agent is doing on it stops (`canDeleteIssue`). */
    delete(orgId: string, id: string): Promise<void>;
    setCriterion(orgId: string, id: string, criterionId: string, done: boolean): Promise<Issue>;
    /** "Mostrar para todos" (ADR 0121): a card from a conversation, shared with the whole workspace. */
    share(orgId: string, id: string): Promise<Issue>;
    /** Who sees it (ADR 0151): anyone who can edit it changes it. */
    setAudience(orgId: string, id: string, audience: AudienceChoice): Promise<Issue>;
    activity(orgId: string, id: string): Promise<IssueActivity[]>;
    comment(orgId: string, id: string, text: string, attachmentIds?: string[]): Promise<IssueActivity>;
    /** "Pedir à Ada para implementar": assigns the agent and starts its work in the task's conversation. */
    askAgent(orgId: string, id: string, agentId: string): Promise<Issue>;
    /** The task's conversation (made on first use): the thread the chat's routes read and post to (ADR 0145). */
    conversation(orgId: string, id: string): Promise<IssueConversationRef>;
    /**
     * "Criar tarefa" on a message: a task whose conversation is the message's thread (ADR doug-0018). A thread that
     * already is a task's gives that task back.
     */
    fromMessage(orgId: string, messageId: string): Promise<Issue & { created: boolean }>;
    /** The board's columns, board order: by stage, then position. */
    columns(orgId: string): Promise<IssueColumn[]>;
    /** Adds a column to a stage (after `afterId` when it is in the same stage, else at the stage's end). */
    addColumn(
      orgId: string,
      input: { name: string; stage: IssueStatus; afterId?: string | null },
    ): Promise<IssueColumn[]>;
    /** Renames a column, or moves it inside its stage (`index`). */
    updateColumn(orgId: string, columnId: string, patch: { name?: string; index?: number }): Promise<IssueColumn[]>;
    /** Deletes a column; its tasks go to `moveTo`. A stage keeps at least one column. */
    deleteColumn(orgId: string, columnId: string, moveTo: string): Promise<IssueColumn[]>;
    projects(orgId: string): Promise<IssueProjects>;
    createProject(orgId: string, input: { name: string; color?: string }): Promise<IssueProject>;
    /** Rename, recolour, archive or bring back. */
    updateProject(
      orgId: string,
      projectId: string,
      patch: { name?: string; color?: string; archived?: boolean },
    ): Promise<IssueProjectRef>;
    /** Its tasks stay, with no project. */
    deleteProject(orgId: string, projectId: string): Promise<void>;
  };
  /** Threads (ADR 0029): the Threads page, a thread from a range, moving it, closing and archiving. */
  threads: {
    /** Threads you can see, most recent activity first (archived only with `tab: "archived"`). */
    list(orgId: string, filters?: ThreadFilters): Promise<ThreadPage>;
    /** A channel's threads (its "Threads (N)"). */
    inChannel(orgId: string, channelId: string, filters?: Omit<ThreadFilters, "channelId">): Promise<ThreadPage>;
    get(orgId: string, threadId: string): Promise<ThreadInfo>;
    /** "Criar thread a partir daqui": the range is its context; nothing moves. */
    create(orgId: string, input: ThreadCreateInput): Promise<ThreadInfo>;
    /** Rename, or change the range ("Ajustar trecho"). */
    update(orgId: string, threadId: string, patch: ThreadPatch): Promise<ThreadInfo>;
    /** Undo a thread made from a range, while nobody replied (`thread.has_replies`). */
    remove(orgId: string, threadId: string): Promise<void>;
    /** Tirar do canal / Devolver ao canal / Fechar / Reabrir / Arquivar / Desarquivar. */
    act(orgId: string, threadId: string, action: ThreadAction): Promise<ThreadInfo>;
  };
  /** Boards and widgets (ADR 0135). */
  dashboards: DashboardsApi;
  /**
   * The approval portal (ADR 9001): the team's board per client and the send for a client's approval. Optional: a
   * client built before it has none. Every call answers 404 `portal.off` on a server without a portal
   * (`AuthConfig.approvalPortal`), 400 `portal.refused` with the portal's own words, 502 `portal.unavailable`.
   * Members read; whoever may give agents work (`assign_work`) changes cards, posts and sends.
   */
  /**
   * Images and videos paid from the workspace's credit wallet (ADR doug-0011). 404 `media.off` on a server without
   * it (`AuthConfig.zimMedia`), 402 `media.no_credits`, 400 `media.refused` with the service's words.
   */
  media?: MediaApi;
  portal?: {
    /** Every client with its counts per column, and how fresh the portal's side is. */
    overview(orgId: string): Promise<PortalOverview>;
    board(orgId: string, client: string): Promise<PortalBoard>;
    createCard(orgId: string, input: PortalCardInput & { client: string; title: string }): Promise<PortalCard>;
    /** Changes a card, or moves it between `todo` and `doing`. */
    updateCard(orgId: string, cardId: string, input: PortalCardInput): Promise<PortalCard>;
    deleteCard(orgId: string, cardId: string): Promise<void>;
    /** Sends Drive files to a client's approval: answers at once with the job, read `job` until it ends. */
    send(orgId: string, input: PortalSendInput): Promise<PortalJob>;
    job(orgId: string, jobId: string): Promise<PortalJob>;
    /** Completes or changes a post at the portal. */
    editItem(orgId: string, client: string, itemId: string, edit: PortalItemEdit): Promise<void>;
    /**
     * Schedules a post the client approved (`scheduledFor`: `YYYY-MM-DDTHH:MM`, in the future): the portal takes it
     * to the publishing service by itself. It turns `scheduled` once that service has it, usually within minutes, and
     * stays `approved` with its date until then.
     */
    schedule(orgId: string, client: string, itemId: string, scheduledFor: string): Promise<void>;
    /** An administrator approves a post in the client's place, with the reason, when the client went quiet. */
    approveForClient(orgId: string, client: string, itemId: string, note?: string): Promise<void>;
    /** A client's strategic schedule: its lists with their cards, the cards in no list, the labels. */
    plan(orgId: string, client: string): Promise<PortalPlan>;
    /** The caller's own open work by production day. */
    mine(orgId: string): Promise<PortalMine>;
    /** Every piece of work not posted yet, across all clients: what the overview draws. */
    pipeline(orgId: string): Promise<PortalPipeline>;
    /** Approved posts nobody scheduled yet, across every client, the longest waiting first. */
    toSchedule(orgId: string): Promise<{ items: PortalItem[] }>;
    /** Each card's task, to name it by its number and open it. */
    tasks(orgId: string): Promise<PortalTaskRef[]>;
    /** Makes a list (the same name answers the same list). */
    createList(orgId: string, client: string, name: string, kind?: PortalListKind): Promise<PortalList>;
    /** Every list of the client, once each, in the new order. */
    orderLists(orgId: string, client: string, ids: string[]): Promise<PortalList[]>;
    renameList(orgId: string, listId: string, name: string): Promise<PortalList>;
    /** Moves a list, with its cards, between the schedule and the client's materials. */
    setListKind(orgId: string, listId: string, kind: PortalListKind): Promise<PortalList>;
    /** Its cards stay, in no list. */
    deleteList(orgId: string, listId: string): Promise<void>;
    labels(orgId: string): Promise<PortalLabel[]>;
    createLabel(orgId: string, input: { name: string; color: PortalLabelColor }): Promise<PortalLabel>;
    updateLabel(
      orgId: string,
      labelId: string,
      change: { name?: string; color?: PortalLabelColor },
    ): Promise<PortalLabel>;
    deleteLabel(orgId: string, labelId: string): Promise<void>;
    /** A client's colour; `null` takes it away. */
    setClientColor(orgId: string, client: string, color: PortalClientColor | null): Promise<void>;
    /** What an approved design piece does for each client set (doug-0010 §8); a client not listed: `portal`. */
    clientSettings?(orgId: string): Promise<{ settings: { client: string; afterApprove: "portal" | "direct" }[] }>;
    setAfterApprove?(orgId: string, client: string, afterApprove: "portal" | "direct"): Promise<void>;
    /** The name the team shows for a client (`null`: the one its id reads as); answers the name kept. */
    setClientName?(orgId: string, client: string, name: string | null): Promise<{ name: string | null }>;
    /** Hides a client from every list, or shows it again; nothing changes at the portal. */
    setClientHidden?(orgId: string, client: string, hidden: boolean): Promise<void>;
    /** A client's logo, cropped square by the app; `null` takes it away. */
    setClientLogo(
      orgId: string,
      client: string,
      image: { imageBase64: string; contentType: string } | null,
    ): Promise<void>;
    /** Anyone who may post comments; answers the card with it. */
    addComment(orgId: string, cardId: string, text: string): Promise<PortalCard>;
    /** One's own, or any for who may give agents work. */
    deleteComment(orgId: string, cardId: string, commentId: string): Promise<PortalCard>;
    /**
     * The installation's own portal's clients (docs/adr/doug-0031-embedded-approval-portal.md): each with its contacts,
     * and the address of its link for whoever may manage the portal (`assign_work`). Empty on a server that keeps a
     * bridge's portal (`AuthConfig.approvalPortalEmbedded`), where the client routes answer 404 `portal.off`.
     */
    clients(orgId: string): Promise<PortalClientsList>;
    /** Makes a client, or changes the one `client` names (its name, contacts, colour). */
    saveClient(
      orgId: string,
      client: string,
      input: {
        name: string;
        contacts?: PortalContact[];
        color?: PortalClientColor | null;
        /** The language its notices are written in; null: the workspace owner's own. */
        locale?: string | null;
      },
    ): Promise<PortalClientAccount>;
    /** Removes a client and its links. */
    removeClient(orgId: string, client: string): Promise<void>;
    /** A new link, revoking the one before: answers the address to send. */
    newClientLink(orgId: string, client: string): Promise<string>;
    /** Revokes a client's link: the address answers nothing from then on. */
    revokeClientLink(orgId: string, client: string): Promise<void>;
    /**
     * The number the portal's notices go out as (`number`, one of `numbers`, or null: e-mail alone), and the workspace's
     * connected numbers to pick from (docs/adr/doug-0031-embedded-approval-portal.md §7).
     */
    noticeSettings(orgId: string): Promise<{ number: string | null; numbers: PortalNoticeNumber[] }>;
    /** Sets the number the portal's notices go out as, or none with null. */
    setNoticeNumber(orgId: string, number: string | null): Promise<void>;
    /** Says a scheduled post is posted: `published`, at `at` (ISO; now when absent), with its address when known. */
    markPublished(
      orgId: string,
      client: string,
      item: string,
      input?: { at?: string | null; postUrl?: string | null },
    ): Promise<void>;
  };
  /** Missions (ADR 0029): long work by the agent's executor on a connected computer, in one thread. */
  missions: {
    /** Missions you can see (the Missões tab), most recently changed first, with the counts for the tabs. */
    list(orgId: string, query?: MissionListQuery): Promise<MissionList>;
    /** "Nova missão": agents that can run a mission for you. */
    eligibleAgents(orgId: string): Promise<MissionEligibleAgent[]>;
    /** "Ver saída": the last lines of a background task. */
    taskOutput(orgId: string, taskId: string, tail?: number): Promise<TaskOutput>;
    /** Pending requests to join (all for whoever answers them; else your own). */
    joinRequests(orgId: string, missionId: string): Promise<MissionJoinRequest[]>;
    /** "Pedir para participar". */
    requestJoin(orgId: string, missionId: string): Promise<MissionJoinRequest>;
    /** Aceitar (with a role) or Recusar. */
    decideJoin(
      orgId: string,
      missionId: string,
      userId: string,
      outcome: "accept" | "decline",
      role?: MissionParticipantRole,
    ): Promise<MissionJoinRequest>;
    /** `/mission <goal>` and "Nova missão": the executor plans it; a plan card follows. */
    create(orgId: string, input: MissionCreateInput): Promise<Mission>;
    get(orgId: string, missionId: string): Promise<Mission>;
    /** The mission of a thread (`mission.not_found` when it has none). */
    ofThread(orgId: string, threadId: string): Promise<Mission>;
    /** The background tasks of a thread, newest first (`machine.task` keeps them live). */
    threadTasks(orgId: string, threadId: string): Promise<MachineTask[]>;
    /** Começar (owner only), `/pause`, resume, `/stop` (cancels its running tasks and pauses). */
    control(orgId: string, missionId: string, action: MissionControl): Promise<Mission & { canceledTasks?: number }>;
    close(
      orgId: string,
      missionId: string,
      input: { outcome: "done" | "canceled"; saveToWiki?: boolean; note?: string; deleteBranch?: boolean },
    ): Promise<Mission>;
    /** "Tentar de novo" after preparing the mission's copy of the project failed. */
    retryWorktree(orgId: string, missionId: string): Promise<Mission>;
    /** "Mudar algo": to the executor's main session (queued when it can't hear now). */
    message(orgId: string, missionId: string, text: string): Promise<{ delivered: boolean; taskId?: string }>;
    participants(orgId: string, missionId: string): Promise<MissionParticipants>;
    setParticipant(
      orgId: string,
      missionId: string,
      userId: string,
      role: MissionParticipantRole,
      existing?: boolean,
    ): Promise<MissionParticipants>;
    removeParticipant(orgId: string, missionId: string, userId: string): Promise<void>;
    /** Hand it over; the computer doesn't move (`code: mission.needs_computer` when it pauses). */
    transfer(
      orgId: string,
      missionId: string,
      input: { userId: string; lendMachine?: boolean },
    ): Promise<Mission & { code?: string }>;
    /** Its owner points it at a computer they paired (new sessions start from the mission files). */
    setMachine(orgId: string, missionId: string, machineId: string, repoDir?: string): Promise<Mission>;
    /** Before Start, its owner switches who programs (the planning starts again). */
    setExecutor(orgId: string, missionId: string, executor: MissionExecutor): Promise<Mission>;
    /** Autonomia (owner or deciders; Revogar sets always). */
    setCommandApproval(
      orgId: string,
      missionId: string,
      commandApproval: CommandApproval,
    ): Promise<{ commandApproval: CommandApproval }>;
    /** "Configurações da missão": the allowed rules, the command stats, the agent's default. */
    settings(orgId: string, missionId: string): Promise<MissionSettings>;
    /** "Quem faz o trabalho": the brain and its model (the brain before Start, the model any time). */
    brain(orgId: string, missionId: string): Promise<MissionBrain>;
    setBrain(
      orgId: string,
      missionId: string,
      input: { brain?: BrainKind | null; model?: string | null },
    ): Promise<MissionBrain>;
    /** The × in "O que já foi liberado" (owner or deciders). */
    removeCommandRule(orgId: string, missionId: string, ruleId: string): Promise<{ rules: MissionCommandRule[] }>;
    /** "Retomar sozinho quando ele voltar" (owner or deciders). */
    setResumeTasks(orgId: string, missionId: string, resumeTasks: boolean): Promise<Mission>;
    /** "Usar como padrão": the autonomy the agent's next missions start with (its owner or an admin). */
    setAgentDefault(
      orgId: string,
      agentId: string,
      commandApproval: CommandApproval,
    ): Promise<{ commandApproval: CommandApproval }>;
    decisions(orgId: string, missionId: string): Promise<MissionDecision[]>;
    /** Commands the executor asked to run (its permission prompts), and the ones allowed for the whole mission. */
    commands(orgId: string, missionId: string): Promise<{ commands: MissionCommand[]; rules: string[] }>;
    /** Aprovar / Recusar / Aprovar sempre nesta missão. */
    decideCommand(
      orgId: string,
      missionId: string,
      commandId: string,
      decision: MissionCommandDecision,
    ): Promise<MissionCommand>;
    /** "Liberar e continuar": allow the commands a task was refused (one or several) and resume it once. */
    retryCommand(
      orgId: string,
      missionId: string,
      input: { taskId: string; command?: string; commands?: string[] },
    ): Promise<{ rules: string[]; delivered: boolean }>;
    /** Delivery cards, newest first. */
    deliveries(orgId: string, missionId: string): Promise<MissionDelivery[]>;
    /** "O que conferir": my own check of one item. */
    checkDelivery(
      orgId: string,
      missionId: string,
      deliveryId: string,
      itemId: string,
      checked: boolean,
    ): Promise<MissionDelivery>;
    /** "Concluir missão" (closes it as done; optionally the wiki page of decisions and lessons). */
    acceptDelivery(
      orgId: string,
      missionId: string,
      deliveryId: string,
      input: { saveToWiki?: boolean },
    ): Promise<Mission>;
    /** "Pedir ajustes": the note goes to the mission's main session; the mission is active again. */
    requestDeliveryChanges(orgId: string, missionId: string, deliveryId: string, note: string): Promise<Mission>;
    choose(orgId: string, missionId: string, decisionId: string, option: string): Promise<MissionDecision>;
    opinion(orgId: string, missionId: string, decisionId: string, option: string): Promise<MissionDecision>;
    approveProvisional(orgId: string, missionId: string): Promise<MissionDecision[]>;
    reviews(orgId: string, missionId: string): Promise<MissionReview[]>;
    review(
      orgId: string,
      missionId: string,
      reviewId: string,
      outcome: "approve" | "changes",
      note?: string,
    ): Promise<MissionReview>;
    suggestion(
      orgId: string,
      missionId: string,
      messageId: string,
      outcome: "accept" | "decline",
    ): Promise<{ messageId: string; status: "accepted" | "declined" }>;
    files(orgId: string, missionId: string): Promise<MissionFiles>;
    summary(orgId: string, missionId: string): Promise<MissionSummary>;
    plan(orgId: string, missionId: string): Promise<MissionPlan>;
  };
  routines: {
    list(orgId: string): Promise<Routine[]>;
    /** `timezone`: IANA zone to read the phrase in (default: the person's own, then the org's). */
    parseSchedule(orgId: string, phrase: string, timezone?: string): Promise<ScheduleParse>;
    create(orgId: string, input: RoutineInput): Promise<Routine>;
    setActive(orgId: string, id: string, active: boolean): Promise<Routine>;
    runNow(orgId: string, id: string): Promise<Routine>;
    /** Stops the run in progress quietly (it ends `canceled`, `stopped` by me). */
    stop(orgId: string, id: string): Promise<Routine>;
    /** An admin or the agent's owner becomes its creator (a routine paused because its creator left). */
    takeOver(orgId: string, id: string): Promise<Routine>;
    /** Continuar agora on a run paused near its plan's or budget's limit (`usagePause`): it goes on now. */
    continueUsage(orgId: string, id: string): Promise<Routine>;
    runs(orgId: string, id: string): Promise<RoutineRun[]>;
    /** A phrase → rule, its description, cron and next 5 runs. */
    parseRule(orgId: string, phrase: string, timezone?: string): Promise<RuleInfo>;
    /** A rule → its description, cron and next 5 runs (the picker's sentence). */
    describeRule(orgId: string, rule: ApiRule): Promise<RuleInfo>;
    /** Only the changed fields; the answer has the new `nextRunAt`. */
    update(orgId: string, id: string, patch: RoutinePatch): Promise<Routine>;
    /** Soft delete: it stops running and leaves the list. */
    remove(orgId: string, id: string): Promise<void>;
    /** `name`: the copy's name in the UI language. */
    duplicate(orgId: string, id: string, name?: string): Promise<Routine>;
    /** A webhook routine's address and latest calls (who may manage it). */
    hook(orgId: string, id: string): Promise<RoutineHook>;
    /** A new address: the old one stops at once. */
    newHookAddress(orgId: string, id: string): Promise<RoutineHook>;
    /** A new signing secret, shown this once. */
    newHookSecret(orgId: string, id: string): Promise<{ secret: string; hook: RoutineHook }>;
    removeHookSecret(orgId: string, id: string): Promise<RoutineHook>;
    /** "Testar": a sample call; the agent is told it is a test. */
    testHook(orgId: string, id: string): Promise<{ runId: string | null; hook: RoutineHook }>;
    /** Whether GitHub's or Sentry's webhook works here, and where and with what to set it up. */
    webhookSetup(orgId: string, provider: WebhookProvider): Promise<WebhookSetup>;
    /** Makes the service's webhook when the workspace has none (who sets webhooks up). */
    ensureWebhook(orgId: string, provider: WebhookProvider): Promise<WebhookSetup>;
    /** The secret the service signs with, pasted from it (Sentry's Client Secret). */
    setWebhookSecret(orgId: string, provider: WebhookProvider, secret: string): Promise<WebhookSetup>;
    /** Adds the GitHub webhook to a repository (`owner/name`) with the workspace's GitHub access. */
    addWebhookToRepo(orgId: string, repo: string): Promise<WebhookSetup>;
  };
  /** The org wiki: pages in folders, `[[links]]`, backlinks, history and the graph. */
  wiki: {
    /** Every page (no bodies), for the tree, tags and recents. */
    tree(orgId: string): Promise<WikiPageSummary[]>;
    get(orgId: string, slug: string): Promise<WikiPage>;
    /** Title prefix search (the `[[` autocomplete, ⌘K). */
    search(orgId: string, q: string): Promise<WikiPageSummary[]>;
    create(orgId: string, input: WikiPageInput): Promise<WikiPage>;
    update(orgId: string, slug: string, input: WikiUpdateInput): Promise<WikiPage>;
    /** New title (and slug); links to it follow. */
    rename(orgId: string, slug: string, title: string): Promise<WikiPage>;
    history(orgId: string, slug: string): Promise<WikiVersion[]>;
    version(orgId: string, slug: string, version: number): Promise<{ version: number; body: string }>;
    graph(orgId: string): Promise<WikiGraph>;
    /** Moves a page to another folder ("" = the root). */
    move(orgId: string, slug: string, folder: string): Promise<WikiPage>;
    /** Admins: only admins edit a locked page. */
    lock(orgId: string, slug: string, locked: boolean): Promise<WikiPage>;
    /** "Fixadas": at the top of the wiki for everyone. */
    pin(orgId: string, slug: string, pinned: boolean): Promise<WikiPage>;
    /** Who sees it (null = every member); for people who edit the wiki and manage roles. */
    /** `audience` alone is for anyone who edits the page; the rest takes managing roles. */
    audience(
      orgId: string,
      slug: string,
      access: Partial<WikiAccess> & Pick<WikiAccess, "audience">,
    ): Promise<WikiPage>;
    /** A folder's audience, and the closest limited folder above it. */
    folderAudience(
      orgId: string,
      folder: string,
    ): Promise<{ own: WikiFolderAudience | null; above: WikiFolderAudience | null }>;
    /** Reaches the pages in it and its subfolders, and the pages that land in it later. */
    setFolderAudience(orgId: string, folder: string, access: WikiAccess): Promise<{ folder: string; pages: number }>;
    /** To the trash (restored from the Lixeira for 30 days). */
    remove(orgId: string, slug: string): Promise<void>;
    /** Many pages to the trash: `kept` counts the ones this person may not delete. */
    removeMany(orgId: string, target: WikiBulkTarget): Promise<{ deleted: number; kept: number }>;
    /** The Lixeira: pages deleted in the last 30 days, most recent first. */
    trash(orgId: string): Promise<WikiPageSummary[]>;
    restoreMany(orgId: string, ids: string[]): Promise<{ restored: number; kept: number; failed: WikiBulkFailed }>;
    /** Deletes pages of the trash for good; no `ids` empties it. */
    purge(orgId: string, ids?: string[]): Promise<{ purged: number; kept: number }>;
    /** Which agents read many pages at once (null = every agent); who sees them stays. */
    setAgents(
      orgId: string,
      ids: string[],
      agentIds: string[] | null,
    ): Promise<{ changed: number; failed: WikiBulkFailed }>;
    /** "Sempre no contexto dos agentes" (at most 3 pages per workspace). */
    context(orgId: string, slug: string, on: boolean): Promise<WikiPage>;
    /** What the agents read most in the last 7 days. */
    reads(orgId: string): Promise<WikiTopRead[]>;
    /** Notes read by the app from a vault, a GitHub link or files (≤ 500 per call; the app batches). */
    import(orgId: string, input: WikiImportInput): Promise<WikiImportResult>;
    /** The Markdown notes behind a GitHub link and the files they may embed, as a zip (nothing is saved). */
    githubNotes(orgId: string, url: string): Promise<Blob>;
    /** Appends a block (e.g. a chat message) with a link back to where it came from. */
    append(
      orgId: string,
      slug: string,
      input: {
        text: string;
        source: { kind: "message"; channelId: string; messageId: string };
      },
    ): Promise<WikiPage>;
  };
  /** My inbox in this organization: mentions, replies, what waits on me. */
  notifications: {
    /** Visible ones (not done, not snoozed), waiting first, then the newest; counts for every filter. */
    list(
      orgId: string,
      query?: { filter?: NotificationFilter; cursor?: string; limit?: number },
    ): Promise<NotificationPage>;
    /** The sidebar badge. */
    count(orgId: string): Promise<NotificationCount>;
    /** "Esperando você": what waits on me, oldest first; `channelId` for one conversation's. */
    waiting(orgId: string, channelId?: string): Promise<WaitingList>;
    read(orgId: string, id: string, read: boolean): Promise<AppNotification>;
    /** "Feito" (`false` undoes it). */
    done(orgId: string, id: string, done: boolean): Promise<AppNotification>;
    /** "Lembrar depois": hidden until `until` (ISO). */
    /** `until: null` ends a snooze early (undo). */
    snooze(orgId: string, id: string, until: string | null): Promise<AppNotification>;
    /** "Marcar tudo como lido": the ids it changed (undo marks them unread again). */
    readAll(orgId: string, filter?: NotificationFilter): Promise<{ ids: string[] }>;
    /** "Concluir todas" but what waits on me: the ids it changed (undo brings each back with `done(…, false)`). */
    doneAll(orgId: string, filter?: NotificationFilter): Promise<{ ids: string[] }>;
    /** What reaches my devices as a notification in this workspace (ADR 0071 §8). */
    prefs(orgId: string): Promise<NoticePrefs>;
    setPref(orgId: string, category: NoticeCategory, on: boolean): Promise<NoticePrefs>;
    /** "Pedir a um admin": an inbox row for whoever may do it (`admin_ask`); how many it reached. */
    askAdmins(orgId: string, ask: AdminAsk): Promise<{ sent: number }>;
  };
  calendar: {
    /** Events, routine runs, reminders, issue deadlines and proposals between `from` and `to` (ISO). */
    range(orgId: string, from: string, to: string): Promise<CalendarRange>;
    create(orgId: string, input: CalendarEventInput): Promise<CalendarEvent>;
    /** Confirms an agent's proposal: creates the event and invites the people. */
    confirmProposal(orgId: string, id: string): Promise<CalendarEvent>;
    dismissProposal(orgId: string, id: string): Promise<void>;
    /** Accepts or declines an invitation (the viewer's own answer). */
    respond(orgId: string, id: string, status: "accepted" | "declined"): Promise<CalendarEvent>;
    /** A recurring event: `scope` and the occurrence's original start say which occurrences change. */
    update(
      orgId: string,
      id: string,
      patch: CalendarEventPatch,
      series?: { scope: SeriesScope; occurrenceStart: string },
    ): Promise<CalendarEvent>;
    remove(orgId: string, id: string, series?: { scope: SeriesScope; occurrenceStart: string }): Promise<void>;
  };
  artifacts: {
    /** Everything the viewer can see, newest update first: the first page. */
    list(orgId: string, filters?: ArtifactFilters): Promise<Artifact[]>;
    /** One page of what the viewer can see (`cursor`: the page before's `nextCursor`), the first with counts. */
    page(orgId: string, filters?: ArtifactFilters, cursor?: string): Promise<ArtifactPage>;
    /** One artifact at `version` (default: latest), with content. */
    get(orgId: string, id: string, version?: number): Promise<ArtifactDetail>;
    /** Keeps a block in the Drive (ADR 0113). */
    keep(orgId: string, id: string): Promise<Artifact>;
    /** Sends what a person picked in a block to the agent that made it, as their own message. */
    reply(orgId: string, id: string, text: string, clientId: string): Promise<{ id: string }>;
    /** A block's state, the same for everyone (ADR 0113). */
    blockState(orgId: string, id: string, version: number): Promise<BlockState>;
    /** Sets values in a block for everyone. */
    setBlockState(orgId: string, id: string, version: number, values: Record<string, unknown>): Promise<BlockState>;
    /** A random pick the server makes once, for everyone. */
    drawBlock(orgId: string, id: string, version: number, name: string, options: string[]): Promise<BlockState>;
    poll(orgId: string, id: string): Promise<Poll>;
    /** Replaces the viewer's marks in a vote; empty takes them back. */
    vote(orgId: string, id: string, options: number[]): Promise<Poll>;
    /** A choice card's answer (ADR 0124). */
    choices(orgId: string, id: string): Promise<Choices>;
    /**
     * Answers a choice card: one option per question, or a written answer (the pick past its last option, the text
     * in `others` at its place), sent to its agent as the person's own message.
     */
    answerChoices(
      orgId: string,
      id: string,
      picks: number[],
      clientId: string,
      others?: (string | null)[],
    ): Promise<{ choices: Choices; messageId: string }>;
    versions(orgId: string, id: string): Promise<ArtifactVersion[]>;
    /** Short-lived signed URL for the stored file. */
    download(orgId: string, id: string, version?: number): Promise<{ url: string; expiresAt: string }>;
    /** Same-origin URL of the file as an attachment, optionally converted (CSV, .patch, PDF). */
    fileUrl(
      orgId: string,
      id: string,
      options?: { version?: number; format?: "csv" | "patch" | "pdf" | "docx" },
    ): string;
    /**
     * Same-origin URL of an uploaded picture's light copy (a WebP, `tile` about 640 px, `view` 2048 px), kept by the
     * browser: for an `<img>`, never the original's weight. GIFs come back as they are.
     */
    pictureUrl(orgId: string, id: string, options: { version?: number; size: "tile" | "view" }): string;
    create(
      orgId: string,
      input: { title: string; channelId?: string | null; content: ArtifactContent },
    ): Promise<ArtifactDetail>;
    /** Uploads a file as is (multipart, up to 2 GB) to the Drive or to a channel; with progress and Cancel. */
    upload(
      orgId: string,
      file: File,
      options?: {
        title?: string;
        channelId?: string | null;
        threadId?: string | null;
        /** A review note's attachment: into that review's conversation, for any member (doug-0014). */
        reviewId?: string | null;
      } & UploadOptions,
    ): Promise<ArtifactDetail>;
    /** A new version of an uploaded file (multipart, ≤ 50 MB). */
    uploadVersion(orgId: string, id: string, file: File, options?: { note?: string }): Promise<ArtifactDetail>;
    /** The bytes of a file version (inline previews of images and PDFs). */
    fileBlob(orgId: string, id: string, version?: number): Promise<Blob>;
    /** Always a new version. `baseVersion` stale → 409. */
    update(
      orgId: string,
      id: string,
      input: { content: ArtifactContent; note?: string | null; baseVersion: number; title?: string },
    ): Promise<ArtifactDetail>;
    /** Who sees it on top of its conversation (ADR 0157); 403 `artifact.sharing_forbidden` for who got it shared. */
    setSharing(
      orgId: string,
      id: string,
      sharing: { mode: ArtifactSharing["mode"]; userIds?: string[]; roleIds?: string[] },
    ): Promise<Artifact>;
    /** To the trash for 30 days (403 `artifact.delete_forbidden`). */
    remove(orgId: string, id: string): Promise<void>;
    trash(orgId: string): Promise<TrashedArtifact[]>;
    /** Back from the trash (409 `artifact.purged` after 30 days). */
    restore(orgId: string, id: string): Promise<ArtifactDetail | undefined>;
    /** Out of the trash for good, now. */
    purge(orgId: string, id: string): Promise<void>;
  };
  storage: {
    get(orgId: string): Promise<StorageConfig>;
    /** Checks a bucket: write, read, list and delete a test object. */
    test(orgId: string, input: S3Input): Promise<StorageTestResult>;
    /** Switches storage. `s3` requires a passing test of the same settings. */
    save(orgId: string, input: StorageSave): Promise<StorageConfig>;
    /** Starts (or resumes) copying existing files to the bucket. */
    migrate(orgId: string): Promise<StorageMigration>;
    migration(orgId: string): Promise<StorageMigration | null>;
  };
  invites: {
    /**
     * The workspace's invitation link (admins, ADR 0068): the active one, else a new one for 30 days. With `choices`
     * (ADR 0184), a link of its own that starts an approval on them; at the defaults, the workspace's link renewed to
     * 30 days. Whoever opens any of them can only ask to join.
     */
    createLink(orgId: string, choices?: InviteLinkChoices): Promise<InviteLinkMade>;
    /** Changes what a link gives (ADR 0184): the same address. `expiresIn` counts from now. */
    editLink(orgId: string, linkId: string, choices: InviteLinkChoices): Promise<InviteLinkChanged>;
    /** The links people can still ask with, earlier ones (no `url`) included. */
    links(orgId: string): Promise<InviteLink[]>;
    /** Nobody new can ask with it; the requests made through it close without emails. */
    turnOff(orgId: string, linkId: string): Promise<void>;
    /** 30 more days for the same link (ADR 0090). */
    renewLink(orgId: string, linkId: string): Promise<{ expiresAt: string }>;
    /**
     * Emails a code that proves the address (ADR 0072): signed out the one typed, signed in the account's own.
     * `join.code_wait` (429) with `retryIn` seconds right after another. `humanCheck`: the bot check's token.
     */
    sendCode(token: string, input: { email?: string }, humanCheck?: string): Promise<CodeSent>;
    /** Checks the code from the email: right, the address can ask for 30 minutes. */
    checkCode(token: string, input: { email?: string; code: string }): Promise<{ verified: true }>;
    /**
     * Asks to join through a link: signed out with a name and an email, signed in as the account. On a server that
     * sends email, `code` proves an address that isn't a confirmed account's.
     */
    ask(
      token: string,
      input: { name?: string; email?: string; note?: string; code?: string; password?: string },
    ): Promise<AskToJoinResult>;
    /** Where the request this page made stands, by its `key` (ADR 0090); null when the key matches nothing. */
    claim(token: string, key: string): Promise<JoinClaim | null>;
    /** Expired email invitation: ask the inviter for a new one. */
    requestNew(token: string): Promise<void>;
  };
  /** Requests to join through the invitation link, for admins (ADR 0068). */
  joinRequests: {
    /** Waiting ones, oldest first. */
    list(orgId: string): Promise<JoinRequest[]>;
    /**
     * `join.answered` / `join.expired` (409) when someone answered first or it ran out. `start`: the channels and
     * agents they start with (ADR 0184); absent, the link's, as far as the approver may give them.
     */
    approve(
      orgId: string,
      requestId: string,
      roleIds?: string[],
      start?: { channelIds?: string[]; agentIds?: string[] },
    ): Promise<JoinApproval>;
    /** `reason` is told to the person by email. */
    deny(orgId: string, requestId: string, reason?: string): Promise<void>;
    /** A member suggests someone to the people who may invite (ADR 0090). */
    suggest(orgId: string, input: { email: string; note?: string }): Promise<{ id: string }>;
    /** This member's suggestions that still wait. */
    mine(orgId: string): Promise<MySuggestion[]>;
    /** Takes back one of this member's suggestions. */
    cancel(orgId: string, requestId: string): Promise<void>;
  };
  /**
   * Phone app additions. Optional so older fakes and clients still type-check;
   * `createHttpApi` has them all (hooks throw when a client lacks one).
   */
  /** Pinned messages of a channel or DM (anyone who can post there pins). */
  pins?: {
    /** Newest pin first. */
    list(orgId: string, channelId: string): Promise<MessagePin[]>;
    /** Pinning again keeps the first pin. `pins.limit` past 100. */
    pin(orgId: string, channelId: string, messageId: string): Promise<MessagePin>;
    unpin(orgId: string, channelId: string, messageId: string): Promise<void>;
  };
  /**
   * Act with undo (ADR 0037 round 2): receipts under an agent's reply. 409 codes:
   * `action.changed_since`, `action.expired`, `action.already_undone`, `action.not_undone`;
   * 403 `action.not_allowed`. The channel also hears `message.actions`.
   */
  actions?: {
    /** Desfazer. */
    undo(orgId: string, actionId: string): Promise<AgentAction>;
    /** Refazer (after an undo, while `undoableUntil` has not passed). */
    redo(orgId: string, actionId: string): Promise<AgentAction>;
    /** Desfazer tudo: every receipt of the message still undoable, newest first. */
    undoMessage(orgId: string, messageId: string): Promise<UndoAllResult>;
  };
  /**
   * The right hand's cards of a workspace change (`workspace_action`): read where it is (its conversation, or the inbox
   * of whom it was sent to), applied as whoever clicks, dismissed, or sent to whoever may. 409 `action_card.decided`.
   */
  actionCards?: {
    get(orgId: string, messageId: string): Promise<WorkspaceActionCardView>;
    decide(
      orgId: string,
      messageId: string,
      decision: "apply" | "dismiss" | "ask",
      /** The card's action id, when this build words it. */
      knows?: string,
    ): Promise<{ card: WorkspaceActionCard }>;
  };
  /** "O que fez por você": what an agent did that involves the viewer (agent profile). */
  agentForYou?: {
    get(orgId: string, agentId: string, limit?: number): Promise<AgentForYou>;
  };
  /** Follow or mute a thread (replies notify and count as unread only while you follow). */
  threadFollows?: {
    follow(orgId: string, threadId: string): Promise<ThreadFollow>;
    unfollow(orgId: string, threadId: string): Promise<ThreadFollow>;
  };
  /** Unread marks: muting a conversation, reading a thread, the threads with unread replies. */
  reads?: {
    mute(orgId: string, channelId: string, muted: boolean): Promise<void>;
    markThreadRead(orgId: string, threadId: string): Promise<void>;
    /** How many threads I follow have a reply I haven't read (at most 100). */
    unreadThreads(orgId: string): Promise<number>;
    /** The tasks whose conversation has a reply I haven't read, with the ones that mention me (ADR 0145). */
    unreadTasks?(orgId: string): Promise<UnreadTask[]>;
  };
  /** "Trabalhando agora": agent runs in progress in the conversations you are in (any member). */
  working?: {
    list(orgId: string): Promise<WorkingRun[]>;
    /** The task manager (ADR 0128): tasks now, what each uses, each agent's last hour, what ended since `since`. */
    taskManager?(orgId: string, since?: string, doneToday?: boolean): Promise<TaskManagerView>;
    /** A task's steps for "Ver passos", to whoever sees it in the task manager (no inputs, no outputs). */
    taskSteps?(orgId: string, runId: string): Promise<TaskSteps>;
    /** Continuar agora on runs paused near a limit (`wait.canContinue`). */
    continueTasks?(orgId: string, runIds: string[]): Promise<{ continued: number }>;
  };
  /** People's mailboxes for agents (ADR 0038): Gmail/Outlook through Composio, the rest by IMAP/SMTP. */
  mail: {
    /** Which ways in this server offers, and the IMAP presets. */
    providers(orgId: string): Promise<MailProviders>;
    accounts(orgId: string): Promise<MailAccount[]>;
    /** Tests the login and both servers first; a `422` carries `MailConnectError` as its code. */
    connectImap(orgId: string, input: MailImapInput): Promise<MailAccount>;
    /**
     * Gmail/Outlook: the page to open; the server sends the person back with `?mail=connected|failed`.
     * `desktop`: started in the desktop app's window, which opens the page in the browser and gets the return back.
     * `accountId` reconnects that mailbox (one that needs it) instead of adding one.
     */
    connectComposio(
      orgId: string,
      input: { provider: "gmail" | "outlook"; label?: string; accountId?: string; desktop?: boolean },
    ): Promise<{ accountId: string; redirectUrl: string }>;
    /** A new name, actions, other addresses and the default From, or a new app password (reconnects an IMAP mailbox). */
    update(orgId: string, accountId: string, input: MailAccountUpdate): Promise<MailAccount>;
    /** Addresses the mailbox has sent from (its sent folder), offered as its other addresses. */
    suggestedAddresses(orgId: string, accountId: string): Promise<string[]>;
    disconnect(orgId: string, accountId: string): Promise<void>;
    folders(orgId: string, accountId: string): Promise<MailFolder[]>;
    /** An agent's access and rules per mailbox. */
    agent(orgId: string, agentId: string): Promise<AgentMailbox[]>;
    setAgent(orgId: string, agentId: string, accountId: string, input: AgentMailboxInput): Promise<AgentMailbox>;
  };
  /** People's Postgres databases for agents (ADR 0039): read-only queries. */
  databases: {
    list(orgId: string): Promise<DatabaseConnection[]>;
    /** Tested first; a `422` carries `DatabaseConnectError` as its code. */
    connect(orgId: string, input: DatabaseConnectionInput): Promise<DatabaseConnection>;
    /** A new name, tools on or off, or a new address or password (tested first). */
    update(
      orgId: string,
      connectionId: string,
      input: DatabaseConnectionInput & { offActions?: DatabaseActionName[] },
    ): Promise<DatabaseConnection>;
    disconnect(orgId: string, connectionId: string): Promise<void>;
    /** On a whole server, of `database` (default: the sample). */
    tables(orgId: string, connectionId: string, database?: string): Promise<DatabaseTable[]>;
    /** A whole-server connection's databases; `refresh` reads the list again. */
    serverDatabases(orgId: string, connectionId: string, refresh?: boolean): Promise<string[]>;
    /** An agent's access and rules per database. */
    agent(orgId: string, agentId: string): Promise<AgentDatabase[]>;
    setAgent(orgId: string, agentId: string, connectionId: string, input: AgentDatabaseInput): Promise<AgentDatabase>;
  };
  /** The agent browser on connected computers (ADR 0040). The live view itself is on the realtime socket. */
  browser: {
    /** Whether its computer serves the browser, and the sites it may open. */
    settings(orgId: string, agentId: string): Promise<AgentBrowserSettings>;
    /** The sites (owner or admins); null or empty = any site. */
    setDomains(orgId: string, agentId: string, allowedDomains: string[] | null): Promise<AgentBrowserSettings>;
    /** The agent's open request or take over on that screen (the browser by default), if any. */
    agentHandoff(orgId: string, agentId: string, screen?: ScreenKind, seat?: Seat): Promise<BrowserHandoff | null>;
    /** Whether this person may drive that screen (take over, open a page, type); watching needs less (ADR 0040). */
    agentControl(orgId: string, agentId: string, screen?: ScreenKind, seat?: Seat): Promise<boolean>;
    handoff(orgId: string, handoffId: string): Promise<BrowserHandoff>;
    /** Take control of a request (one person at a time; 409 when someone else has it). */
    takeControl(orgId: string, handoffId: string): Promise<BrowserHandoff>;
    /**
     * "Pronto", or "Devolver" for a take over: the agent reads the page again and goes on, told who
     * had it, for how long, the pages, and `note` as the person's own words.
     */
    done(orgId: string, handoffId: string, note?: string): Promise<BrowserHandoff>;
    /** "Não consegui", with an optional reason the agent reads. */
    failed(orgId: string, handoffId: string, note?: string): Promise<BrowserHandoff>;
    cancel(orgId: string, handoffId: string): Promise<BrowserHandoff>;
    /**
     * Take over while watching; the agent waits until handed back. `runId`: the run whose card it
     * was taken from (the take over is bound to it, so its card stays in that conversation).
     */
    takeover(orgId: string, agentId: string, runId?: string, screen?: ScreenKind, seat?: Seat): Promise<BrowserHandoff>;
    /**
     * The person in control opens a site (a bare host gets https://), or goes back, forward or reloads; a closed
     * browser opens. 409 `browser.not_in_control`, 403 `browser.not_allowed` (outside the agent's sites), 400
     * `browser.bad_address` or `browser.open_failed`.
     */
    open(orgId: string, agentId: string, to: PageTarget): Promise<void>;
    /** "Parar": closes the agent's browser now (its logins stay). Its screen has no stop: it stays on. */
    stop(orgId: string, agentId: string, seat?: Seat): Promise<void>;
    /**
     * "Tentar de novo" on a page that never came: the browser closes and opens again where it was (its logins
     * stay), and every live view gets it again. Resolves once it closed. Only who may drive it (403 otherwise).
     */
    restart(orgId: string, agentId: string): Promise<void>;
  };
  /**
   * Browser profiles (ADR 0110): named, shared logins on one computer. Everyone sees the list; creating, choosing
   * who may use one and deleting take "apps e computadores" (403 otherwise); logging in also takes driving
   * computers. The live view is `browser.watch` with `agentId: "profile:<id>"`.
   */
  browserProfiles?: {
    list(orgId: string, machineId?: string): Promise<BrowserProfile[]>;
    /** 409 `browser_profile.name_taken`; 400 `browser_profile.machine` (outdated runner); 400 `browser_profile.system_mode` (never offered there). */
    create(orgId: string, input: { machineId: string; name: string; agentIds: string[] }): Promise<BrowserProfile>;
    update(orgId: string, profileId: string, input: { name?: string; agentIds?: string[] }): Promise<BrowserProfile>;
    remove(orgId: string, profileId: string): Promise<void>;
    /** "Fazer login": this person takes control (agents wait); 409 `browser_profile.busy` while another has it. */
    takeover(orgId: string, profileId: string): Promise<BrowserProfile>;
    /** "Devolver". */
    handback(orgId: string, profileId: string): Promise<BrowserProfile>;
    /** The person in control opens a site, or goes back, forward or reloads. */
    open(orgId: string, profileId: string, to: PageTarget): Promise<void>;
    /** The agent's default browser: a profile it may use, or null for its own. */
    setDefault(orgId: string, agentId: string, profileId: string | null): Promise<void>;
    /** "Pedir mais um perfil": the people who grant profiles hear of it. */
    request(orgId: string, agentId: string): Promise<void>;
  };
  /**
   * WhatsApp numbers the workspace connected and their conversations. Connecting and changing a number takes
   * `manage_connectors`; its conversations are its listed people's. 404 while the server has no gateway and for a
   * number the person isn't listed on; 502 `whatsapp.unavailable` when the gateway refuses. Optional so older fakes
   * type-check (`createHttpApi` has it).
   */
  /**
   * Videos agents sent for the team's review, notes on their seconds and the decision back to the agent
   * (docs/adr/doug-0007-video-review.md). Optional so older fakes type-check (`createHttpApi` has it).
   */
  videoReviews?: {
    list(orgId: string): Promise<{ reviews: VideoReviewSummary[] }>;
    get(orgId: string, reviewId: string): Promise<VideoReview>;
    /** A version's video for the player: the light copy for phones, or the original with `original` (HD). */
    videoUrl(orgId: string, reviewId: string, version: number, options?: { original?: boolean }): string;
    addNote(orgId: string, reviewId: string, input: VideoReviewNoteInput): Promise<VideoReviewNote>;
    addVoiceNote(orgId: string, reviewId: string, input: VideoReviewVoiceInput): Promise<VideoReviewNote>;
    deleteNote(orgId: string, reviewId: string, noteId: string): Promise<void>;
    decide(
      orgId: string,
      reviewId: string,
      input: { decision: VideoReviewDecision; message?: string; caption?: string },
    ): Promise<VideoReviewSummary>;
    /** A design version's slide, as a picture (`page` from 1). */
    pageUrl?(orgId: string, reviewId: string, version: number, page: number): string;
    /** A design version's editable page, as text (run only in an isolated frame). */
    source?(orgId: string, reviewId: string, version: number): Promise<string>;
    /** Saves a design piece edited by hand as its next version. */
    saveDesign?(orgId: string, reviewId: string, input: DesignEditInput): Promise<VideoReviewSummary>;
    /** The review sent from a task, if any (docs/adr/doug-0012-editor-delivery.md). */
    taskVideo?(orgId: string, issueId: string): Promise<{ reviewId: string | null; reviewIds?: string[] }>;
    /** Sends the video a person edited for a task (a file already uploaded to the task's conversation). */
    sendTaskVideo?(
      orgId: string,
      issueId: string,
      input: { artifactId: string; note?: string; reviewId?: string },
    ): Promise<{ review: VideoReviewSummary; toClient: boolean }>;
    /** Sends work a person made (a video or a design piece) for review, or its next version (doug-0015). */
    sendWork?(orgId: string, input: PersonWorkInput): Promise<{ review: VideoReviewSummary; toClient: boolean }>;
    /** Sets the post's cover and caption, and approves each. */
    setPost?(orgId: string, reviewId: string, patch: ReviewPostPatch): Promise<ReviewPost>;
    /** Sends the approved post to the client (or straight to scheduling, for a `direct` client). */
    sendToClient?(
      orgId: string,
      reviewId: string,
    ): Promise<{ delivery: Record<string, unknown>; afterApprove: "portal" | "direct" }>;
    /** Tries the final's backup again. */
    retryFinal?(orgId: string, reviewId: string): Promise<void>;
    /** Each person's WhatsApp conversation for the changes asked of them. */
    whatsappTargets?(orgId: string): Promise<{ targets: ReviewWhatsAppTarget[] }>;
    /** Sets (or, with null, takes away) where a person is told. */
    setWhatsappTarget?(
      orgId: string,
      userId: string,
      target: { accountId: string; chatId: string } | null,
    ): Promise<{ target: ReviewWhatsAppTarget | null }>;
  };
  whatsapp?: {
    overview(orgId: string): Promise<WhatsAppOverview>;
    connect(orgId: string, label: string): Promise<WhatsAppAccount>;
    reconnect(orgId: string, accountId: string): Promise<WhatsAppAccount>;
    update(orgId: string, accountId: string, patch: WhatsAppAccountPatch): Promise<WhatsAppAccount>;
    remove(orgId: string, accountId: string): Promise<{ removed: boolean; leftover: string | null }>;
    /** `before`: the `next` of the page before. */
    chats(orgId: string, accountId: string, before?: string): Promise<WhatsAppChatPage>;
    messages(orgId: string, accountId: string, chatId: string, before?: string): Promise<WhatsAppMessagePage>;
    send(orgId: string, accountId: string, input: WhatsAppSendInput): Promise<{ chatId: string }>;
    read(orgId: string, accountId: string, chatId: string): Promise<{ read: number }>;
    /** The person is writing there (or stopped): the other side sees "typing…". */
    typing(orgId: string, accountId: string, chatId: string, typing: boolean): Promise<{ told: boolean }>;
    /** Sends a file, or a recording as a voice message (`voice`), into a conversation. */
    sendFile(
      orgId: string,
      accountId: string,
      input: { chatId: string; file: Blob; fileName: string; caption?: string; voice?: boolean },
    ): Promise<{ chatId: string; kind: string }>;
    /** The stickers the number sent or received lately, each a message's id (its picture: `whatsappFileUrl`). */
    stickers(orgId: string, accountId: string): Promise<{ stickers: { messageId: string; at: string }[] }>;
    /** Sends a sticker the number already has into a conversation. */
    sendSticker(
      orgId: string,
      accountId: string,
      input: { chatId: string; messageId: string },
    ): Promise<{ chatId: string }>;
    /** Asks the phone for the conversation's older messages: they arrive a moment later, if the phone has them. */
    olderHistory(orgId: string, accountId: string, chatId: string): Promise<{ asked: number }>;
    /** The number's agent on or off in one conversation; on gives the conversation back to it. */
    chatAgent(orgId: string, accountId: string, chatId: string, on: boolean): Promise<{ on: boolean }>;
    /** Who the contact is: a member (their messages go to their conversation with the agent), a portal client, or neither. */
    chatContact(
      orgId: string,
      accountId: string,
      chatId: string,
      input: { member: string | null; client: string | null },
    ): Promise<{ member: string | null; client: string | null }>;
    /** The approval portal's clients a contact may be. */
    clients(orgId: string): Promise<{ clients: string[] }>;
    /** The voices a number's agent may speak in. */
    voices(orgId: string): Promise<WhatsAppVoices>;
    /** What thinks on the number: an AI of its own, or its agent's (managers who may choose the agent's AI). */
    brain(orgId: string, accountId: string): Promise<WhatsAppBrain>;
    /** The number answers with this AI from now on; its agent's own is untouched. */
    setBrain(orgId: string, accountId: string, input: WhatsAppBrainInput): Promise<WhatsAppBrain>;
    /** The number answers with its agent's own AI again. */
    clearBrain(orgId: string, accountId: string): Promise<WhatsAppBrain>;
    /**
     * The number's instructions rewritten by its AI with a new direction, typed (`text`) or recorded (`audio`, with
     * its length in `seconds`), on top of `current` (the settings' text, saved or not). Nothing is saved.
     */
    draftInstructions(
      orgId: string,
      accountId: string,
      input: { text?: string; audio?: { file: Blob; fileName: string; seconds?: number }; current?: string },
    ): Promise<WhatsAppInstructionsDraft>;
  };
  /**
   * The Vault (ADR 0144): logins, keys and contacts agents use without seeing a password or a key. No answer carries
   * a value: once saved, it never comes back to an app (§2). Personal items are their owner's alone; team items take
   * `manage_credentials` to create and edit. Optional so older fakes type-check (`createHttpApi` has it).
   */
  vault?: {
    overview(orgId: string): Promise<VaultOverview>;
    /** 404 for an item this person can't see. */
    item(orgId: string, itemId: string): Promise<VaultItemDetail>;
    create(orgId: string, input: VaultItemInput): Promise<VaultItem>;
    update(orgId: string, itemId: string, patch: VaultItemPatch): Promise<VaultItem>;
    remove(orgId: string, itemId: string): Promise<void>;
    /** A passwords file's text; `dryRun` only counts. 413 `vault.csv_too_large` past 2 MB. */
    importCsv(orgId: string, input: { csv: string; scope: VaultScope; dryRun: boolean }): Promise<VaultImportResult>;
    /** Several keys in one save (an imported .env). 403 `vault.team_needs_permission` for the team's without it. */
    importKeys(orgId: string, input: VaultKeysImportInput): Promise<VaultKeysImportResult>;
    /**
     * Moves an item kept here between Personal and Team. Either way takes `manage_credentials`; to Personal it
     * becomes the mover's. 409 `vault.key_name_taken` when a key of that name is already there.
     */
    move(orgId: string, itemId: string, scope: VaultScope): Promise<VaultItem>;
    /** Checked with the password manager first: 400 `vault.source.<code>` when it refuses. */
    connect(orgId: string, input: VaultConnectInput): Promise<VaultConnection>;
    updateConnection(orgId: string, connectionId: string, patch: VaultConnectionPatch): Promise<VaultConnection>;
    syncConnection(orgId: string, connectionId: string): Promise<VaultConnection>;
    removeConnection(orgId: string, connectionId: string): Promise<void>;
  };
  /**
   * The agent's screen (ADR 0058): its state. The screen itself is a WebSocket (`desktopSocketUrl`), which
   * starts it when it isn't running; control and "Devolver" are the browser's screen routes with `desktop`.
   */
  desktop: {
    status(orgId: string, agentId: string, seat?: Seat): Promise<DesktopStatus>;
    /** A recent picture of the agent's screen; never starts a stopped one. 403 for who may not watch it. */
    picture(orgId: string, agentId: string, seat?: Seat): Promise<DesktopPictureView>;
    /** What the agent keeps running there (ADR 0176); 403 for who may not watch its computer. */
    holds(orgId: string, agentId: string): Promise<AgentHolds>;
    /** Stop: the hold ends, and its program stops or its browser closes. 403 for who may not (`canStop`). */
    stopHold(orgId: string, agentId: string, holdId: string): Promise<void>;
  };
  /**
   * GIF search (ADR 0091), through our server: the browser and the phone never talk to the provider. Every member;
   * rate limited per person (429). 404 `gifs.off` when this server has no GIF search or the workspace turned GIFs
   * off. A GIF's file is `gifMediaUrl` (`lib/media.ts`).
   */
  gifs?: {
    /** Free text (`q`), a category, or neither (what is trending), at the workspace's rating. */
    search(orgId: string, query: GifQuery): Promise<GifPage>;
  };
  /**
   * AI apps (ADR 0119): the consent page an app's sign-in opens (`/autorizar?req=`), and Settings → AI apps. A
   * consent answers once (409 `request_used`); 410 `request_expired` past its 30 minutes.
   */
  apps: {
    consent(requestId: string): Promise<AppConsent>;
    /** Where the browser goes next, back in the app (with `error=access_denied` on deny): go there once. */
    decide(requestId: string, input: AppConsentDecision): Promise<{ redirectTo: string }>;
    /** Yours here; `all`: everyone's, with `person` (needs `manage_members`). */
    list(orgId: string, all?: boolean): Promise<AppsList>;
    disconnect(orgId: string, grantId: string): Promise<void>;
    /** 409 `token_limit` past 10 live tokens per person here. */
    createToken(orgId: string, input: PersonalTokenInput): Promise<CreatedPersonalToken>;
    revokeToken(orgId: string, grantId: string): Promise<void>;
  };
  /** "Lembrar": one-off reminders in conversations (also routines in Rotinas). */
  reminders?: {
    create(orgId: string, input: ReminderInput): Promise<Reminder>;
    /** Your pending ones, soonest first. */
    list(orgId: string): Promise<Reminder[]>;
    cancel(orgId: string, reminderId: string): Promise<Reminder>;
  };
}

/** Everything is served by the HTTP backend (apps/server/src/routes/app). */
export type HttpApi = ApiClient;
