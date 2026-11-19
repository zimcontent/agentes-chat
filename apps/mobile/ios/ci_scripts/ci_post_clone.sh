#!/bin/sh
# Xcode Cloud, after it clones the repo and before it builds (apps/mobile/README.md, "iOS on Xcode Cloud"): the
# Expo app commits no native project, so this makes it here: bun and node, the dependencies, `expo prebuild` (through
# scripts/prebuild-ios.sh, which keeps this folder aside meanwhile; never `--clean`: it would delete it) and CocoaPods. Xcode Cloud then builds, tests or archives
# `apps/mobile/ios/DougBot.xcworkspace` as its workflow says.
#
# Environment variables, set in the workflow (App Store Connect › Xcode Cloud › the workflow › Environment):
#   APPLE_TEAM_ID          the team that signs the app and its extensions
#   IOS_BUILD_NUMBER_BASE  added to Xcode Cloud's own build number, so builds come after the ones sent from EAS
#   DOUGBOT_PRANCHA=1      only for a workflow that runs the board (sample screens, no account) on simulators
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"

# Node 24 (Expo SDK 58 wants 22.13 or later) and CocoaPods from Homebrew; bun at the version package.json names.
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node@24 cocoapods
export PATH="/usr/local/opt/node@24/bin:/opt/homebrew/opt/node@24/bin:$PATH"
BUN_VERSION=$(node -p "require('./package.json').packageManager.split('@')[1]")
curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
export PATH="$HOME/.bun/bin:$PATH"

bun install --frozen-lockfile

export APP_VARIANT="${APP_VARIANT:-production}"
export IOS_BUILD_NUMBER=$(( ${IOS_BUILD_NUMBER_BASE:-0} + ${CI_BUILD_NUMBER:-0} ))
echo "DougBot build $IOS_BUILD_NUMBER ($APP_VARIANT)"

cd apps/mobile
sh scripts/prebuild-ios.sh
cd ios
pod install
