/**
 * Expo config plugin: keeps react-native-webrtc's Java classes through R8 in Android release builds. Its library
 * refers to optional codecs (org.webrtc.Dav1dDecoder and others) that aren't in the package, and R8 stops on a
 * missing class; the classes it does ship are called from native code by name, so they must not be renamed or
 * dropped either (voice calls, docs/adr/doug-0006-live-voice.md).
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MARK = "# agentes: react-native-webrtc";
const RULES = `
${MARK}
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keep class com.oney.WebRTCModule.** { *; }
`;

module.exports = function withWebrtcProguard(config) {
  return withDangerousMod(config, [
    "android",
    async (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!now.includes(MARK)) fs.writeFileSync(file, `${now}${RULES}`);
      return c;
    },
  ]);
};
