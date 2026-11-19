/**
 * The notification service extension (docs/adr/doug-0021-lock-screen.md): a push about a live block brings its
 * buttons' words, and this registers them as the push's category before the notification shows. Added by
 * @bacons/apple-targets at `expo prebuild`, signed with the app's team like the share extension.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: "notification-service",
  name: "DougNotice",
  bundleIdentifier: ".notice",
  deploymentTarget: "16.4",
  frameworks: ["UserNotifications"],
});
