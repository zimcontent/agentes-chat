import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../src");
const src = (path: string) => readFileSync(join(root, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

test("chat and Drive uploads go as parts Expo's fetch sends (`filePart`), never React Native's { uri } part", () => {
  // Expo's fetch refuses `{ uri, name, type }` ("Unsupported FormDataPart implementation"): no upload ever left.
  expect(src("features/chat/ChatScreen.tsx")).toContain("filePart(file.uri, file.name, file.type)");
  expect(src("features/drive/useDriveUpload.ts")).toContain("filePart(a.uri, a.name,");
  // The part reads its bytes, once it knows they fit what the phone can hold in memory (`fitsFilePart`).
  expect(src("features/review/media.ts")).toContain("if (!fitsFilePart(file.size))");
  expect(src("features/review/media.ts")).toContain("return file.bytes();");
});

test("no `{ uri, name, type }` part sent through fetch anywhere: only `streamedPart`, for XMLHttpRequest with progress", () => {
  const offenders = files(root).filter((path) => {
    const text = readFileSync(path, "utf8");
    // A `{ uri, … }` object turned into an upload's file part.
    return /\{\s*uri[:,][^}]*\}\s*\)?\s*as unknown as (Blob|File|Parameters<typeof api\.[\w.]+upload)/.test(text);
  });
  expect(offenders.map((p) => p.slice(root.length + 1))).toEqual(["features/review/media.ts"]);
  expect(src("features/review/media.ts")).toContain("export const streamedPart");
  // The old shape, a `{ uri }` object cast on its way to the upload, is gone from the chat and the Drive.
  for (const file of ["features/chat/ChatScreen.tsx", "features/drive/useDriveUpload.ts"])
    expect(src(file)).not.toContain("React Native's FormData sends `{ uri, name, type }`");
});

test("photos and workspace marks load through expo-image, cached, with no fade", () => {
  for (const file of ["agent/PersonAvatar.tsx", "features/shared/OrgAvatar.tsx"]) {
    const face = src(file);
    for (const piece of [
      'import { Image } from "expo-image";',
      'cachePolicy="memory-disk"',
      "recyclingKey=",
      "transition={0}",
    ])
      expect({ file, piece, there: face.includes(piece) }).toEqual({ file, piece, there: true });
    expect({ file, rn: /import \{[^}]*\bImage\b[^}]*\} from "react-native"/.test(face) }).toEqual({ file, rn: false });
  }
  // The backend's photos still go with the session's headers.
  expect(src("features/shared/OrgAvatar.tsx")).toContain("photoSource(logo, serverOf(on), appHeaders(lastCookie(on)))");
});

test("the lists' times are written with formats made once per language", () => {
  const hooks = src("features/shared/hooks.ts");
  const when = hooks.slice(hooks.indexOf("export function useWhen()"), hooks.indexOf("export function useNow("));
  expect(when).not.toContain("new Intl.DateTimeFormat");
  expect(when).toContain("const formats = whenFormatsOf(locale);");
});

test("the snapshot saves at most every 30 s and once as the app leaves, its write awaited", () => {
  const providers = src("providers/AppProviders.tsx");
  expect(providers).toContain("const SNAPSHOT_EVERY_MS = 30_000;");
  expect(providers).toContain("{ saveAfterMs: SNAPSHOT_EVERY_MS }");
  expect(providers).toContain("void snapshot.flush();");
  expect(src("lib/snapshot.ts")).toContain("await file().write(value);");
});
