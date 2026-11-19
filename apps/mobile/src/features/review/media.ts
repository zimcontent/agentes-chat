import { ApiError, type ReviewWords, reviewWords } from "@dougbot/client";
import { File } from "expo-file-system";
import { useTranslation } from "react-i18next";
import { appHeaders, lastCookie } from "@/lib/auth";
import { FILE_PART_MAX_BYTES, fitsFilePart } from "./logic";

export { FILE_PART_MAX_BYTES } from "./logic";

/** The review's words in the app's language (shared with the web: `@dougbot/client`). */
export function useReviewWords(): ReviewWords {
  const { i18n } = useTranslation();
  return reviewWords(i18n.language);
}

/** One of our files as the player or an image loads it: with the session, like every other picture of ours. */
export const ownSource = (uri: string) => ({ uri, headers: appHeaders(lastCookie()) });

/**
 * A file on the phone as a form's part. The app's fetch is Expo's, whose FormData takes a part with `bytes()` (its
 * name and type from `name` and `type`) and refuses React Native's `{ uri }` part (as the voice messages learned).
 * The size is checked when the upload reads it (`bytes()` runs inside the fetch's own promise), never as the part is
 * made: a caller that builds it inline gets a failed upload, not a throw.
 */
export function filePart(uri: string, name: string, type: string): Blob {
  const file = new File(uri);
  return {
    name,
    type,
    bytes: async () => {
      if (!fitsFilePart(file.size))
        throw new ApiError(413, "upload.too_large", `${name} is over ${FILE_PART_MAX_BYTES / 1024 / 1024} MB`);
      return file.bytes();
    },
  } as unknown as Blob;
}

/**
 * A large file (a video up to 2 GB) as an upload's part when the upload reports its progress: that one goes by React
 * Native's `XMLHttpRequest` (the client's `onProgress`), which streams the file from its `uri` and never holds it in
 * memory. Expo's fetch (no progress) refuses this part: send it only with `onProgress`.
 */
export const streamedPart = (uri: string, name: string, type: string): Blob => ({ uri, name, type }) as unknown as Blob;
