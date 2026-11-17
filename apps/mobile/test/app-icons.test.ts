import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_ICONS,
  DEFAULT_APP_ICON,
  DEFAULT_MADE_ICON,
  MADE_ICON_COLORS,
  MADE_ICON_FACES,
  MADE_ICON_GROUNDS,
  MADE_ICON_POSES,
  madeIconId,
  madeIconOf,
  madeIcons,
} from "@agenteschat/client/lib/app-icons";
import { Resvg } from "@resvg/resvg-js";
import { opaquePng } from "../scripts/icon-png.mjs";
import * as Doug from "../src/brand/doug-icons.js";
import { iconOfNativeName, nativeIconName, phoneIcons } from "../src/features/me/app-icon-names";

interface Node {
  $?: Record<string, string>;
  [child: string]: unknown;
}
interface Manifest {
  manifest: { application: { activity?: Node[]; "activity-alias"?: Node[] }[] };
}

// The config plugin is plain CommonJS (expo prebuild loads it); its pure parts are tested here.
const plugin = require("../plugins/with-app-icons") as {
  ICONS: string[];
  MADE: { grounds: string[]; colors: string[]; faces: string[]; poses: string[] };
  MADE_IDS: string[];
  iosName: (id: string) => string;
  androidAlias: (id: string) => string;
  androidRes: (id: string) => string;
  launcherAliases: (manifest: Manifest) => Manifest;
};

const ASSETS = join(import.meta.dir, "..", "assets", "app-icons");
const filter = (...names: [string, string][]) => ({
  action: names.filter(([k]) => k === "action").map(([, n]) => ({ $: { "android:name": n } })),
  category: names.filter(([k]) => k === "category").map(([, n]) => ({ $: { "android:name": n } })),
});
/** Expo's MainActivity: the launcher's filter and one for links. */
const manifest = (): Manifest => ({
  manifest: {
    application: [
      {
        activity: [
          {
            $: { "android:name": ".MainActivity", "android:exported": "true" },
            "intent-filter": [
              filter(["action", "android.intent.action.MAIN"], ["category", "android.intent.category.LAUNCHER"]),
              filter(["action", "android.intent.action.VIEW"], ["category", "android.intent.category.BROWSABLE"]),
            ],
          },
        ],
        "activity-alias": [{ $: { "android:name": ".SomethingElse" } }],
      },
    ],
  },
});

describe("app icons on the phone (ADR 0179; the Doug's, doug-0010)", () => {
  test("the plugin, the app and the shared list name the same icons", () => {
    expect(plugin.ICONS).toEqual([...APP_ICONS]);
    for (const id of APP_ICONS) {
      expect(nativeIconName(id, "ios")).toBe(id === DEFAULT_APP_ICON ? null : plugin.iosName(id));
      expect(nativeIconName(id, "android")).toBe(plugin.androidAlias(id));
      expect(iconOfNativeName(nativeIconName(id, "ios"), "ios")).toBe(id);
      expect(iconOfNativeName(nativeIconName(id, "android"), "android")).toBe(id);
    }
    expect(iconOfNativeName("AppIcon-gone", "ios")).toBe(DEFAULT_APP_ICON);
    expect(plugin.androidRes("peekNight")).toBe("ic_launcher_peek_night");
  });

  test("Android's launcher entry moves to one alias per icon, only the shipped one on", () => {
    const out = plugin.launcherAliases(manifest());
    const app = out.manifest.application[0];
    const main = app?.activity?.[0];
    // The links' filter stays on MainActivity; the launcher's leaves it.
    expect(main?.["intent-filter"]).toEqual([
      filter(["action", "android.intent.action.VIEW"], ["category", "android.intent.category.BROWSABLE"]),
    ]);
    const aliases = app?.["activity-alias"] ?? [];
    expect(aliases.slice(0, 6).map((a) => a.$?.["android:name"])).toEqual([
      ".SomethingElse",
      ".AppIconNight",
      ".AppIconMoon",
      ".AppIconSky",
      ".AppIconPeekNight",
      ".AppIconPeekSky",
    ]);
    const ours = aliases.slice(1);
    // The ready ones, then every icon a person can make, as the app lists them for the module.
    expect(ours.map((a) => a.$?.["android:name"])).toEqual(phoneIcons().map((i) => `.${nativeIconName(i, "android")}`));
    expect(ours.map((a) => a.$?.["android:enabled"])).toEqual(["true", ...ours.slice(1).map(() => "false")]);
    expect(ours[5]?.$?.["android:icon"]).toBe("@mipmap/ic_launcher_made_day_green_normal");
    expect(ours[0]?.$?.["android:icon"]).toBe("@mipmap/ic_launcher");
    expect(ours[3]?.$?.["android:icon"]).toBe("@mipmap/ic_launcher_peek_night");
    for (const alias of ours) {
      expect(alias.$?.["android:targetActivity"]).toBe(".MainActivity");
      expect(alias["intent-filter"]).toEqual([
        filter(["action", "android.intent.action.MAIN"], ["category", "android.intent.category.LAUNCHER"]),
      ]);
    }
    // A second prebuild gives the same manifest.
    expect(plugin.launcherAliases(structuredClone(out))).toEqual(out);
  });

  test("the icons a person makes: the plugin, the drawing, the app and the shared list name the same", () => {
    expect(plugin.MADE).toEqual({
      grounds: [...MADE_ICON_GROUNDS],
      colors: [...MADE_ICON_COLORS],
      faces: [...MADE_ICON_FACES],
      poses: [...MADE_ICON_POSES],
    });
    expect(Doug.ICON_GROUNDS).toEqual([...MADE_ICON_GROUNDS]);
    expect(Doug.ICON_COLORS).toEqual([...MADE_ICON_COLORS]);
    expect(Doug.ICON_FACES).toEqual([...MADE_ICON_FACES]);
    expect(Doug.ICON_POSES).toEqual([...MADE_ICON_POSES]);
    expect(Doug.SHIPPED_ICON).toEqual(DEFAULT_MADE_ICON);
    const made = madeIcons();
    // 2 grounds × 8 colors × 10 faces × 2 poses.
    expect(made).toHaveLength(320);
    expect(Doug.madeIcons().map(Doug.madeIconId)).toEqual(made.map(madeIconId));
    expect(plugin.MADE_IDS).toEqual(made.map(madeIconId));
    expect(new Set(made.map((icon) => nativeIconName(icon, "android"))).size).toBe(320);
    for (const icon of made) {
      const id = madeIconId(icon);
      expect(madeIconOf(id)).toEqual(icon);
      expect(nativeIconName(icon, "ios")).toBe(plugin.iosName(id));
      expect(nativeIconName(icon, "android")).toBe(plugin.androidAlias(id));
      expect(iconOfNativeName(nativeIconName(icon, "ios"), "ios")).toEqual(icon);
      expect(iconOfNativeName(nativeIconName(icon, "android"), "android")).toEqual(icon);
    }
    expect(plugin.iosName("made-night-pink-wink")).toBe("AppIcon-made-night-pink-wink");
    expect(plugin.androidAlias("made-night-pink-wink")).toBe("AppIconMadeNightPinkWink");
    expect(plugin.androidRes("made-night-pink-wink-peek")).toBe("ic_launcher_made_night_pink_wink_peek");
    expect(madeIconOf("made-night-pink-wink-peek")).toEqual({
      ground: "night",
      color: "pink",
      face: "wink",
      pose: "peek",
    });
    // Upstream's made icons (a sky, an agent's color, a face or an accessory) are no icon here.
    expect(madeIconOf("made-sky-rose-heart")).toBeNull();
    expect(madeIconOf("made-night-pink-crown")).toBeNull();
    expect(madeIconOf("made-night-pink-wink-up")).toBeNull();
    expect(madeIconOf("night")).toBeNull();
  });

  test("each made icon is its own picture: its ground, color, face and pose all show", () => {
    /** The icon drawn at 48 px, as bytes. */
    const picture = (patch: Partial<typeof DEFAULT_MADE_ICON>) =>
      Buffer.from(
        new Resvg(Doug.iconSvg({ ...DEFAULT_MADE_ICON, ...patch }), { fitTo: { mode: "width", value: 48 } })
          .render()
          .asPng(),
      ).toString("base64");
    const faces = MADE_ICON_FACES.map((face) => picture({ face }));
    expect(new Set(faces).size).toBe(MADE_ICON_FACES.length);
    const colors = MADE_ICON_COLORS.map((color) => picture({ color, ground: "night" }));
    expect(new Set(colors).size).toBe(MADE_ICON_COLORS.length);
    expect(picture({ pose: "peek" })).not.toBe(picture({}));
    expect(picture({ ground: "night" })).not.toBe(picture({}));
    // Every layer is a whole SVG of the 1024 square.
    for (const layer of ["whole", "back", "front", "mono", "tinted", "favicon"] as const)
      expect(Doug.iconSvg({ ...DEFAULT_MADE_ICON, pose: "peek" }, layer)).toMatch(
        /^<svg [^>]*width="1024"[\s\S]*<\/svg>$/,
      );
  });

  test("the committed pictures are the drawing's: the ready icons' and the shipped icon's", () => {
    expect(Object.keys(Doug.READY_ICONS)).toEqual([...APP_ICONS]);
    for (const id of APP_ICONS) {
      const { light, dark } = Doug.READY_ICONS[id];
      expect(readFileSync(join(ASSETS, id, "preview.png")).equals(opaquePng(Doug.iconSvg(light), 180))).toBe(true);
      expect(readFileSync(join(ASSETS, id, "preview-dark.png")).equals(opaquePng(Doug.iconSvg(dark), 180))).toBe(true);
    }
    // The app's own icon (scripts/brand-assets.ts) is the shipped one.
    const icon = readFileSync(join(import.meta.dir, "..", "assets", "images", "icon.png"));
    expect(icon.equals(opaquePng(Doug.iconSvg(Doug.SHIPPED_ICON), 1024))).toBe(true);
  });

  test("every icon has the files the app and the plugin read", () => {
    const missing: string[] = [];
    for (const id of APP_ICONS) {
      const files = [
        "ios.png",
        "ios-dark.png",
        "ios-tinted.png",
        "android-foreground.png",
        "android-background.png",
        "android-monochrome.png",
        "preview.png",
        "preview-dark.png",
        ...(id === DEFAULT_APP_ICON ? [] : ["android-legacy.png"]),
      ];
      for (const file of files) if (!existsSync(join(ASSETS, id, file))) missing.push(`${id}/${file}`);
    }
    expect(missing).toEqual([]);
  });

  test("the desktop app lists the same icons, and the web has their files at their sizes", () => {
    const ROOT = join(import.meta.dir, "..", "..", "..");
    const rust = readFileSync(join(ROOT, "apps/desktop/src-tauri/src/app_icon.rs"), "utf8");
    expect([...rust.matchAll(/icon!\("(\w+)"\)/g)].map((m) => m[1])).toEqual([...APP_ICONS]);
    const read = (path: string) => readFileSync(join(ROOT, path));
    /** A PNG's width and height (its IHDR), and an .ico's images' sizes. */
    const sizeOf = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    const icoSizes = (bytes: Buffer) => Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => bytes[6 + 16 * i]);
    for (const id of APP_ICONS) {
      for (const look of ["ios", "ios-dark", "ios-tinted"])
        expect(sizeOf(read(`apps/mobile/assets/app-icons/${id}/${look}.png`))).toEqual([1024, 1024]);
      expect(sizeOf(read(`apps/web/public/app-icons/${id}.png`))).toEqual([160, 160]);
      expect(icoSizes(read(`apps/web/public/app-icons/${id}.ico`))).toEqual([16, 32, 48]);
    }
    expect(icoSizes(read("apps/web/public/favicon.ico"))).toEqual([16, 32, 48]);
    expect(sizeOf(read("apps/web/public/apple-touch-icon.png"))).toEqual([180, 180]);
    expect(sizeOf(read("apps/web/public/icon-512.png"))).toEqual([512, 512]);
  });
});
