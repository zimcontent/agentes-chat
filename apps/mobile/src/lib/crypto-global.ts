import { getRandomValues, randomUUID } from "expo-crypto";

/**
 * Hermes has no `crypto` global, and the shared client reaches for it (a new message's `clientId`, among others):
 * without this, every send threw `ReferenceError: Property 'crypto' doesn't exist`. The app gives the two calls the
 * shared code uses, from expo-crypto's secure random source. Imported first by the root layout.
 */
const g = globalThis as { crypto?: Partial<Crypto> };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function")
  g.crypto.getRandomValues = getRandomValues as unknown as Crypto["getRandomValues"];
if (typeof g.crypto.randomUUID !== "function") g.crypto.randomUUID = randomUUID as Crypto["randomUUID"];
