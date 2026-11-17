/**
 * Expo config plugin: the app icons a person may pick on their phone (ADR 0179), besides the one the app ships with
 * (`ios.icon` and `android.adaptiveIcon` in app.config.ts). Their files are assets/app-icons/<id>/, written by
 * scripts/app-icons.ts from the Doug (DougBot); the ids are packages/client's `APP_ICONS` (a test keeps them equal).
 * - iOS: one `AppIcon-<id>` set per icon in the asset catalog, in light, dark and tinted (iOS 18), named in
 *   ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES so the build lists them in Info.plist; the app switches with
 *   `setAlternateIconName` (modules/app-icon).
 * - Android: there is no call for it, so the launcher's entry moves from MainActivity to one `activity-alias` per icon
 *   (`.AppIcon<Id>`, only the shipped one on), each with its adaptive icon (back, front and one-color layers, and a
 *   PNG for Android 7); the app turns the picked one on and the others off.
 *
 * Besides those five, the icons a person makes (DougBot's: the Doug on a ground, in a color, with a face, facing or
 * leaning in from the corner, docs/adr/doug-0010-doug-app-icons.md; `MADE`, 320 of them). A phone takes only icons its
 * build carries, so every combination is one more icon of the same two kinds. Their files are not in the repository:
 * scripts/made-icons.mjs draws them here from the identity's code (src/brand/doug-icons.js), once per version of it
 * (kept in node_modules/.cache/app-icons). A made icon has one look on iOS, and on Android shares its back layer
 * (its ground and color) and its one-color layer (its face) with the others of the same pose.
 */
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withAndroidManifest, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const ICONS = ["night", "moon", "sky", "peekNight", "peekSky"];
/** The shipped icon is the app's own (`AppIcon`, `ic_launcher`); these are the others. */
const OTHERS = ICONS.slice(1);
const ASSETS = "assets/app-icons";

/** What a made icon is made of, as packages/client's lists and the drawing's (tests keep the three equal). */
const MADE = {
  grounds: ["day", "night"],
  colors: ["green", "yellow", "orange", "pink", "violet", "blue", "cyan", "white"],
  faces: ["normal", "happy", "wink", "surprised", "unimpressed", "sad", "angry", "aside", "laugh", "asleep"],
  poses: ["front", "peek"],
};
/** `made-<ground>-<color>-<face>`, and `…-peek` for the leaning Doug, in the lists' order. */
const MADE_ICONS = MADE.poses.flatMap((pose) =>
  MADE.grounds.flatMap((ground) =>
    MADE.colors.flatMap((color) =>
      MADE.faces.map((face) => ({
        id: `made-${ground}-${color}-${face}${pose === "peek" ? "-peek" : ""}`,
        ground,
        color,
        face,
        pose,
      })),
    ),
  ),
);
const MADE_IDS = MADE_ICONS.map((icon) => icon.id);

const GENERATOR = "scripts/made-icons.mjs";
/** What the made icons are drawn from: a change to any of these draws them again. */
const GENERATOR_SOURCES = [GENERATOR, "src/brand/doug-icons.js", "src/brand/dougbot-avatar.js"];

/** The folder with the made icons' files, drawn now if these scripts never drew them. */
function madeFiles(projectRoot) {
  const hash = createHash("sha1");
  for (const file of GENERATOR_SOURCES) hash.update(fs.readFileSync(path.join(projectRoot, file)));
  const dir = path.join(projectRoot, "node_modules", ".cache", "app-icons", hash.digest("hex").slice(0, 16));
  const done = path.join(dir, "done");
  if (!fs.existsSync(done)) {
    console.log(`with-app-icons: drawing ${MADE_IDS.length} icons (a few minutes, once)`);
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(projectRoot, GENERATOR), dir], { stdio: "inherit" });
    fs.writeFileSync(done, "");
  }
  return dir;
}

/** The icon's name in the iOS asset catalog (the shipped one is `AppIcon`, named `null` to UIKit). */
const iosName = (id) => `AppIcon-${id}`;
/** Its launcher entry on Android, relative to the app's package. */
const androidAlias = (id) =>
  `AppIcon${id
    .split("-")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join("")}`;
/** Its resources on Android (lowercase and underscores): `peekNight` → `ic_launcher_peek_night`. */
const androidRes = (id) => `ic_launcher_${id.replace(/-/g, "_").replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

/** The asset catalog's Contents.json for one icon's three looks (as Expo writes the shipped one's). */
function iosContents(files) {
  return {
    images: files.map(({ filename, appearance }) => ({
      filename,
      idiom: "universal",
      platform: "ios",
      size: "1024x1024",
      ...(appearance ? { appearances: [{ appearance: "luminosity", value: appearance }] } : {}),
    })),
    info: { author: "expo", version: 1 },
  };
}

const IOS_LOOKS = [
  { file: "ios.png", appearance: null },
  { file: "ios-dark.png", appearance: "dark" },
  { file: "ios-tinted.png", appearance: "tinted" },
];

function withIosIcons(config) {
  const withFiles = withDangerousMod(config, [
    "ios",
    async (c) => {
      const { projectRoot, platformProjectRoot, projectName } = c.modRequest;
      const catalog = path.join(platformProjectRoot, projectName, "Images.xcassets");
      for (const id of OTHERS) {
        const dir = path.join(catalog, `${iosName(id)}.appiconset`);
        fs.mkdirSync(dir, { recursive: true });
        const files = IOS_LOOKS.map(({ file, appearance }) => {
          const filename = `App-Icon${appearance ? `-${appearance}` : ""}-1024x1024@1x.png`;
          fs.copyFileSync(path.join(projectRoot, ASSETS, id, file), path.join(dir, filename));
          return { filename, appearance };
        });
        fs.writeFileSync(path.join(dir, "Contents.json"), `${JSON.stringify(iosContents(files), null, 2)}\n`);
      }
      const made = madeFiles(projectRoot);
      for (const id of MADE_IDS) {
        const dir = path.join(catalog, `${iosName(id)}.appiconset`);
        fs.mkdirSync(dir, { recursive: true });
        const filename = "App-Icon-1024x1024@1x.png";
        fs.copyFileSync(path.join(made, id, "ios.png"), path.join(dir, filename));
        const contents = iosContents([{ filename, appearance: null }]);
        fs.writeFileSync(path.join(dir, "Contents.json"), `${JSON.stringify(contents, null, 2)}\n`);
      }
      return c;
    },
  ]);
  return withXcodeProject(withFiles, (c) => {
    const project = c.modResults;
    const { target } = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: c.modRequest.projectName,
    });
    for (const [, build] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      target.buildConfigurationList,
    )) {
      build.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = `"${[...OTHERS, ...MADE_IDS].map(iosName).join(" ")}"`;
    }
    return c;
  });
}

const LAUNCHER = "android.intent.category.LAUNCHER";
const isLauncher = (filter) => (filter.category ?? []).some((c) => c.$?.["android:name"] === LAUNCHER);

/**
 * The manifest with the launcher's entry moved from MainActivity to one alias per icon (the shipped one on, with the
 * app's own `ic_launcher`). Run again, it gives the same: the aliases it made are replaced, nothing else is touched.
 */
function launcherAliases(manifest) {
  const app = manifest.manifest.application?.[0];
  const main = app?.activity?.find((a) => a.$?.["android:name"] === ".MainActivity");
  if (!main) throw new Error("with-app-icons: no .MainActivity in AndroidManifest.xml");
  main["intent-filter"] = (main["intent-filter"] ?? []).filter((f) => !isLauncher(f));
  const others = (app["activity-alias"] ?? []).filter((a) => !String(a.$?.["android:name"]).startsWith(".AppIcon"));
  app["activity-alias"] = [
    ...others,
    ...[...ICONS, ...MADE_IDS].map((id, i) => ({
      $: {
        "android:name": `.${androidAlias(id)}`,
        "android:targetActivity": ".MainActivity",
        "android:enabled": i === 0 ? "true" : "false",
        "android:exported": "true",
        "android:icon": i === 0 ? "@mipmap/ic_launcher" : `@mipmap/${androidRes(id)}`,
        "android:roundIcon": i === 0 ? "@mipmap/ic_launcher_round" : `@mipmap/${androidRes(id)}`,
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
          category: [{ $: { "android:name": LAUNCHER } }],
        },
      ],
    })),
  ];
  return manifest;
}

/**
 * One icon's adaptive icon (Android 8+); its layers are 432 px, Android's largest, in drawable-nodpi. A made icon's
 * back and one-color layers are another resource's, shared (`back`, `mono`).
 */
const adaptiveXml = (
  res,
  back = `${res}_background`,
  mono = `${res}_monochrome`,
) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/${back}"/>
    <foreground android:drawable="@drawable/${res}_foreground"/>
    <monochrome android:drawable="@drawable/${mono}"/>
</adaptive-icon>
`;
/** The layers the made icons share: a ground in a color behind, a face's one-color shape, each pose its own. */
const tail = (pose, sep) => (pose === "peek" ? `${sep}peek` : "");
const madeBack = (ground, color, pose) => `ic_launcher_made_back_${ground}_${color}${tail(pose, "_")}`;
const madeMono = (face, pose) => `ic_launcher_made_mono_${face}${tail(pose, "_")}`;

function withAndroidIcons(config) {
  const withAliases = withAndroidManifest(config, (c) => {
    c.modResults = launcherAliases(c.modResults);
    return c;
  });
  return withDangerousMod(withAliases, [
    "android",
    async (c) => {
      const { projectRoot, platformProjectRoot } = c.modRequest;
      const res = path.join(platformProjectRoot, "app", "src", "main", "res");
      const put = (dir, name, from) => {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.copyFileSync(from, path.join(res, dir, name));
      };
      for (const id of OTHERS) {
        const name = androidRes(id);
        const from = (file) => path.join(projectRoot, ASSETS, id, file);
        for (const layer of ["background", "foreground", "monochrome"])
          put("drawable-nodpi", `${name}_${layer}.png`, from(`android-${layer}.png`));
        put("mipmap-xxxhdpi", `${name}.png`, from("android-legacy.png"));
        fs.mkdirSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true });
        fs.writeFileSync(path.join(res, "mipmap-anydpi-v26", `${name}.xml`), adaptiveXml(name));
      }
      const made = madeFiles(projectRoot);
      for (const pose of MADE.poses) {
        for (const ground of MADE.grounds)
          for (const color of MADE.colors)
            put(
              "drawable-nodpi",
              `${madeBack(ground, color, pose)}.png`,
              path.join(made, `back-${ground}-${color}${tail(pose, "-")}`, "android-background.png"),
            );
        for (const face of MADE.faces)
          put(
            "drawable-nodpi",
            `${madeMono(face, pose)}.png`,
            path.join(made, `mono-${face}${tail(pose, "-")}`, "android-monochrome.png"),
          );
      }
      for (const { id, ground, color, face, pose } of MADE_ICONS) {
        const name = androidRes(id);
        put("drawable-nodpi", `${name}_foreground.png`, path.join(made, id, "android-foreground.png"));
        put("mipmap-xxxhdpi", `${name}.png`, path.join(made, id, "android-legacy.png"));
        fs.writeFileSync(
          path.join(res, "mipmap-anydpi-v26", `${name}.xml`),
          adaptiveXml(name, madeBack(ground, color, pose), madeMono(face, pose)),
        );
      }
      return c;
    },
  ]);
}

const withAppIcons = (config) => withAndroidIcons(withIosIcons(config));

module.exports = withAppIcons;
module.exports.ICONS = ICONS;
module.exports.MADE = MADE;
module.exports.MADE_IDS = MADE_IDS;
module.exports.iosName = iosName;
module.exports.androidAlias = androidAlias;
module.exports.androidRes = androidRes;
module.exports.launcherAliases = launcherAliases;
module.exports.iosContents = iosContents;
