import Constants from "expo-constants";

/** Removes trailing slashes: "https://app.agentes.chat/" → "https://app.agentes.chat". */
export const trimBase = (url: string) => url.replace(/\/+$/, "");

/** DougBot's own server (the Time Zim's), the default when the build names none. */
export const DOUGBOT_SERVER = "https://dougbot.app";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; variant?: string };

/**
 * The build's server: `extra.apiUrl` from app.config.ts (env `EXPO_PUBLIC_API_URL` at build time). The person
 * can choose another one ("Seu servidor"); read the current one with `serverUrl()` (src/lib/server.ts).
 */
export const API_URL = trimBase(extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? DOUGBOT_SERVER);

/** "development" | "preview" | "production". */
export const APP_VARIANT = extra.variant ?? "production";

/**
 * The deep-link scheme the server trusts for the app (app.config.ts `scheme`: DougBot answers `dougbot://` and this
 * one, kept so sign-in, OAuth returns and the server's QR codes keep working against an unchanged server).
 */
export const SCHEME = "agenteschat";

/** Prefix for everything the app keeps in SecureStore (keys allow only letters, digits, ".", "-" and "_"). */
export const STORAGE_PREFIX = "agenteschat";
