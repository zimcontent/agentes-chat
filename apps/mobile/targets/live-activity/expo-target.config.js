/**
 * The Live Activity's widget extension (docs/adr/doug-0021-lock-screen.md), added to the iOS project by
 * @bacons/apple-targets at `expo prebuild`. Signed with the app's team (`ios.appleTeamId`, from APPLE_TEAM_ID) and
 * registered for EAS's credentials like the share extension. It reads the agent's face from the app group the share
 * extension already shares with the app (`group.<bundle id>`). Named "DougLive", not the app's name: two targets of
 * one name made EAS sign the app with an extension's profile.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: "widget",
  name: "DougLive",
  displayName: "Doug",
  bundleIdentifier: ".live",
  deploymentTarget: "16.4",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  entitlements: {
    "com.apple.security.application-groups": [`group.${config.ios.bundleIdentifier}`],
  },
  // The stage and the green of the identity (apps/mobile/src/brand/tokens.ts).
  colors: { $accent: "#9CFA05", $widgetBackground: "#0A0A0A" },
});
