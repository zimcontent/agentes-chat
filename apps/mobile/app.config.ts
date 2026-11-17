import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * DougBot's Expo config (the fork of agentes.chat by Codari Global, LLC, AGPL-3.0; identity in
 * identidade/dougbot-identidade). The app's Expo config. Builds: the "Android build" and "iOS build" workflows on GitHub Actions, or EAS (see
 * README.md). The native projects are made from this file by `expo prebuild` and never committed.
 * - `EXPO_PUBLIC_API_URL`: the server the app talks to by default (production: https://dougbot.app); people
 *   can pick their own.
 * - `EAS_PROJECT_ID`: the EAS project (the iPhone's Expo push tokens need it). Not set here on purpose: `eas init`
 *   creates the owner's own project on expo.dev and writes its id below (`DOUGBOT_EAS_PROJECT_ID`), or the build's
 *   environment gives it. Never upstream's project.
 * - `APP_VARIANT`: "development" | "preview" | "production" (from eas.json or the workflow), so the three install
 *   side by side.
 * - `GOOGLE_SERVICES_JSON`: path to Firebase's google-services.json, for push on Android (FCM).
 * - `ANDROID_VERSION_CODE`: the build's version code, set by the Android workflow (EAS numbers its own builds).
 * - `APPLE_TEAM_ID`: the Apple team that signs the iOS app and its share extension (a build setting, never in the
 *   repo).
 * - `IOS_BUILD_NUMBER`: the build's number on iOS, set by the iOS workflow.
 *
 * The New Architecture is the only one since SDK 55, so there is no `newArchEnabled` flag any more
 * (the SDK 58 config type no longer has it). Edge-to-edge on Android is likewise always on.
 */
const variant = process.env.APP_VARIANT ?? "production";
const prancha = process.env.DOUGBOT_PRANCHA === "1";
const suffix = variant === "production" ? "" : `.${variant}`;
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://dougbot.app";
// Links to this host open the app (universal links / App Links); the server publishes the matching /.well-known
// files (apps/server/src/app-links.ts).
const linkHost = new URL(apiUrl).host;

/**
 * The website's pages that open the app on Android (its intent filters; `*` is any text), the same list the server
 * gives iOS (`APP_LINK_PATHS` in apps/server/src/app-links.ts, a test keeps them equal): what the app has a screen for
 * (`appLinkFromUrl`, src/features/links/app-links.ts). Settings sections are listed one by one: Android can't
 * leave a page out of a filter, and billing (Stripe returns there) must stay the website's. A change here reaches
 * phones only with a new build.
 */
export const APP_LINK_PATTERNS = [
  "/invite/*",
  "/reset-password",
  "/signup",
  "/org/*/home",
  "/org/*/dashboards",
  "/org/*/dashboards/*",
  "/org/*/review",
  "/org/*/review/*",
  "/org/*/c/*",
  "/org/*/dm/*",
  "/org/*/threads",
  "/org/*/threads/*",
  "/org/*/agents/*",
  "/org/*/approvals",
  "/org/*/proposals",
  "/org/*/task-manager",
  "/org/*/notifications",
  "/org/*/issues",
  "/org/*/issues/*",
  "/org/*/routines",
  "/org/*/search",
  "/org/*/drive",
  "/org/*/wiki",
  "/org/*/wiki/*",
  "/org/*/members",
  "/org/*/settings",
  "/org/*/settings/account",
  "/org/*/settings/notifications",
  "/org/*/settings/apps",
  "/org/*/settings/general",
  "/org/*/settings/members",
  "/org/*/settings/invites",
  "/org/*/settings/audit",
  "/org/*/settings/access",
  "/org/*/settings/connectors",
  "/org/*/settings/skills",
  "/org/*/settings/keys",
  "/org/*/settings/storage",
  "/org/*/settings/computers",
  "/org/*/settings/devices",
  "/org/*/settings/usage",
  "/org/*/settings/import",
  "/org/*/settings/media",
  "/org/*/settings/approvals",
  "/org/*/settings/right_hand",
  "/org/*/settings/roles",
  "/org/*/settings/vault",
  "/org/*/settings/about",
  "/org/*/settings/computers/*",
  "/org/*/settings/devices/*",
];
/** Optional alternate app icons (ADR 0179). */
const ICONS = "./assets/app-icons";
// DougBot's EAS project on expo.dev (not a secret: it only names the project). Empty until the owner runs `eas init`
// (TESTFLIGHT.md), which fills it in; `EAS_PROJECT_ID` in the environment wins.
const DOUGBOT_EAS_PROJECT_ID = "da14fac0-0136-48a5-a4ab-f59280bf25d6";
const projectId = process.env.EAS_PROJECT_ID || DOUGBOT_EAS_PROJECT_ID || undefined;
/** The app's name on the home screen and in the stores. */
const APP_NAME = "DougBot";
// The bundle id / package: app.dougbot (the dougbot.app domain, reversed), with .preview and .development side by side.
const BUNDLE_ID = `app.dougbot${suffix}`;
// expo-image-picker and expo-camera both set iOS's camera text: one text for both uses (pt-BR and the other languages
// in assets/locales/*.json win on phones in those languages).
const CAMERA_USE = "To take pictures for your conversations and your agents' photos, and to scan QR codes.";
// Voice messages and voice calls share the microphone's text (expo-audio and react-native-webrtc both set it).
const MICROPHONE_USE = "To record voice messages and to talk on voice calls.";

/**
 * Paths the app no longer has, so a stale link, notification or restored URL never lands on "not found": the old
 * Início and Conversas routes go to Conversas (`/`); the agents' setup screens that left the phone (creating,
 * editing, removing an agent, its Advanced and "Usar em outros agentes") go to "Seu time agora" (`/agents`) or to the
 * agent's own profile. expo-router applies these to deep links and to in-app navigation alike. (`/search` is the
 * search tab again.)
 */
export const LEGACY_REDIRECTS = [
  { source: "/chats", destination: "/" },
  { source: "/home", destination: "/" },
  { source: "/new-agent", destination: "/agents" },
  { source: "/agent-edit", destination: "/agents" },
  { source: "/agent-delete", destination: "/agents" },
  { source: "/agent-more/[id]", destination: "/agent/[id]" },
  { source: "/agent-setup/[id]", destination: "/agent/[id]" },
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant === "production" ? APP_NAME : `${APP_NAME} ${variant}`,
  slug: "dougbot",
  // `dougbot://` is the app's own; `agenteschat://` stays as a second scheme because the server trusts it for the app's
  // sign-in, OAuth returns and the "open on the phone" QR codes (apps/server/src/auth.ts `APP_SCHEME`,
  // packages/engine/src/connectors/oauth-return.ts, packages/client/src/lib/server.ts).
  scheme: ["dougbot", "agenteschat"],
  version: "0.1.0",
  // Upright everywhere (the plugin below); only the agent's screen, in control, lies down (`useSideways`).
  orientation: "default",
  // The icon the app ships with (ADR 0179); the others a person may pick are added by ./plugins/with-app-icons.
  // All of them are the Doug (scripts/app-icons.ts, scripts/brand-assets.ts; docs/adr/doug-0010-doug-app-icons.md).
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    // The icon in iOS's three appearances (scripts/brand-assets.ts draws them from the Doug's code): his black head
    // on the green glass, his head in green glass on the stage for dark icons, and that picture in greys for the
    // system to tint.
    icon: {
      light: "./assets/images/icon.png",
      dark: "./assets/images/icon-dark.png",
      tinted: "./assets/images/icon-tinted.png",
    },
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
    ...(process.env.IOS_BUILD_NUMBER ? { buildNumber: process.env.IOS_BUILD_NUMBER } : {}),
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${linkHost}`],
    // App Store Connect asks about encryption on every build: only the system's HTTPS, so exempt (no export papers).
    config: { usesNonExemptEncryption: false },
    // A voice call goes on with the screen locked or another app open (docs/adr/doug-0006-live-voice.md, the phone app).
    infoPlist: { ITSAppUsesNonExemptEncryption: false, UIBackgroundModes: ["audio"] },
  },
  android: {
    package: BUNDLE_ID,
    // Firebase's config comes from the build's environment, so the public repo carries none and a self-built app
    // brings its own Firebase project.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    ...(process.env.ANDROID_VERSION_CODE ? { versionCode: Number(process.env.ANDROID_VERSION_CODE) } : {}),
    // Two layers (the green glass, the Doug's head on it), so the launcher's mask and motion cut them like the iOS
    // icon, and the one-colour layer a themed home screen tints. All drawn from his code (scripts/brand-assets.ts).
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundImage: "./assets/images/adaptive-icon-background.png",
      monochromeImage: "./assets/images/adaptive-icon-monochrome.png",
      // The glass's own green, under its picture.
      backgroundColor: "#9CFA05",
    },
    predictiveBackGestureEnabled: false,
    // Never read the phone's photos or play in the background: the image picker is Android's photo picker, Salvar em
    // Fotos only adds (MediaStore needs no permission for it) and voice messages stop when the app leaves. Google
    // Play asks a justification for the media reads and a video for a media-playback foreground service, so keep
    // them out even if a library's manifest brings them.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      // react-native-webrtc's plugin asks to draw over other apps (picture in picture for video), which calls don't use.
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: APP_LINK_PATTERNS.map((pattern) => ({
          scheme: "https",
          host: linkHost,
          pathPattern: pattern.replace(/\*/g, ".*"),
        })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  // Native permission texts (the OS shows them before the app's i18n runs). Only ready languages
  // (@agenteschat/i18n/locale), here and in `supportedLocales`: the stores list these as the app's languages.
  locales: {
    en: "./assets/locales/en.json",
    "pt-BR": "./assets/locales/pt-BR.json",
    es: "./assets/locales/es.json",
    fr: "./assets/locales/fr.json",
    de: "./assets/locales/de.json",
    it: "./assets/locales/it.json",
    nl: "./assets/locales/nl.json",
    ja: "./assets/locales/ja.json",
    ko: "./assets/locales/ko.json",
    "zh-Hans": "./assets/locales/zh-Hans.json",
    id: "./assets/locales/id.json",
    tr: "./assets/locales/tr.json",
    pl: "./assets/locales/pl.json",
    ru: "./assets/locales/ru.json",
  },
  plugins: [
    // `DOUGBOT_PRANCHA=1 expo start --web`: the visual board (`prancha/`, the app's own components with sample data,
    // for the Q&A in a browser). Never in a build.
    ["expo-router", { redirects: LEGACY_REDIRECTS, ...(prancha ? { root: "./prancha" } : {}) }],
    ["expo-screen-orientation", { initialOrientation: "PORTRAIT_UP" }],
    "expo-secure-store",
    // Every ready language, so Android 13+ and iOS offer it as the app's own language.
    [
      "expo-localization",
      {
        supportedLocales: ["en", "pt-BR", "es", "fr", "de", "it", "nl", "ja", "ko", "zh-Hans", "id", "tr", "pl", "ru"],
      },
    ],
    "expo-web-browser",
    "expo-apple-authentication",
    [
      "expo-splash-screen",
      {
        // The first frame of the animated splash (src/features/launch): same image, size and background as
        // the app (white in light), so the hand-over doesn't show. Keep LOGO in launch/logic.ts in step.
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        // DougBot's light stage and dark stage (`--db-palco`), the Doug drawn from his code (scripts/brand-assets.ts).
        backgroundColor: "#F4F6F2",
        dark: { image: "./assets/images/splash-icon.png", backgroundColor: "#0A0A0A" },
      },
    ],
    [
      // Pushes come straight from Firebase and from Apple with the system's own token (ADR 0152, ADR 0178). The
      // plugin's `aps-environment` entitlement stays as it is: the profile that signs an iPhone build decides which
      // of Apple's push environments its tokens belong to (a store build's is production), and the app reads that
      // from the profile when it registers (src/lib/push.ts).
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#9CFA05",
      },
    ],
    // Android release builds signed with the upload key from the environment (the Android build workflow).
    "./plugins/with-android-release-signing",
    // The app icons a person may pick (ADR 0179): iOS's alternate icons and Android's launcher aliases.
    "./plugins/with-app-icons",
    [
      "expo-image-picker",
      {
        photosPermission: "To send pictures in your conversations and choose your agents' photos.",
        cameraPermission: CAMERA_USE,
      },
    ],
    [
      // Escanear QR code (Seu servidor): QR codes only, so no microphone.
      "expo-camera",
      { cameraPermission: CAMERA_USE, microphonePermission: false, recordAudioAndroid: false },
    ],
    [
      // Mensagens de voz (ADR 0100): the app records only while the person holds or locks the button.
      "expo-audio",
      // No background playback (the plugin's default is on): it would add a media-playback foreground service.
      {
        microphonePermission: MICROPHONE_USE,
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
      },
    ],
    [
      // Voice calls (docs/adr/doug-0006-live-voice.md, the phone app): WebRTC to the people on the call and to the
      // agents' GPT-Live voices. Audio only; the camera's text stays the QR code's.
      "@config-plugins/react-native-webrtc",
      { cameraPermission: CAMERA_USE, microphonePermission: MICROPHONE_USE },
    ],
    // Its Java classes kept through R8 in release builds (optional codecs it refers to are missing).
    "./plugins/with-webrtc-proguard",
    [
      // "Compartilhar com…": the app in the system's share sheet (an iOS share extension and Android's send intents),
      // for photos, videos, files, links and text; what arrives opens the agent picker (src/features/share). The
      // extension takes the app's name and shares its URL scheme; it reaches phones only with a new native build.
      "expo-share-intent",
      {
        // "Doug", not the app's name: the extension's target is named from it, and two targets both called "DougBot"
        // made EAS sign the app with the extension's provisioning profile.
        iosShareExtensionName: variant === "production" ? "Doug" : `Doug ${variant}`,
        iosActivationRules: {
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: 10,
          NSExtensionActivationSupportsMovieWithMaxCount: 10,
          NSExtensionActivationSupportsFileWithMaxCount: 10,
        },
        androidIntentFilters: ["text/*", "image/*", "video/*", "application/*"],
        androidMultiIntentFilters: ["image/*", "video/*", "*/*"],
      },
    ],
    [
      // Salvar em Fotos: add-only access (the read text matches expo-image-picker's). No granular reads on Android:
      // saveToPhotos asks write-only, which needs none from Android 13 on.
      "expo-media-library",
      {
        photosPermission: "To send pictures in your conversations and choose your agents' photos.",
        savePhotosPermission: "To save pictures from your conversations to Photos.",
        granularPermissions: [],
      },
    ],
  ],
  experiments: { typedRoutes: false },
  web: { bundler: "metro", output: "single" },
  extra: {
    apiUrl,
    variant,
    ...(projectId ? { eas: { projectId } } : {}),
  },
  runtimeVersion: { policy: "appVersion" },
});
