#!/bin/sh
# `expo prebuild` for iOS on a checkout whose ios/ holds only the committed ci_scripts/ (Xcode Cloud's, README "iOS on
# Xcode Cloud"). Prebuild reuses an ios/ folder that exists and makes no Xcode project in it, so ci_scripts/ waits
# outside while the project is made and goes back afterwards, even when prebuild fails. Never `--clean`: it deletes
# ios/, ci_scripts/ with it. An ios/ that already has its project (a Podfile) is prebuilt as it is.
#
# Usage, from anywhere: sh apps/mobile/scripts/prebuild-ios.sh [more expo prebuild flags]
set -eu
cd "$(dirname "$0")/.."

if [ -d ios/ci_scripts ] && [ ! -e ios/Podfile ]; then
  aside=$(mktemp -d)
  mv ios/ci_scripts "$aside/ci_scripts"
  # shellcheck disable=SC2064 # the folder is fixed now, on purpose
  trap "mkdir -p ios && mv '$aside/ci_scripts' ios/ci_scripts && rmdir '$aside'" EXIT
  # Only Finder's leftovers may stay behind; anything else stops here and ci_scripts/ goes back.
  find ios -name .DS_Store -delete
  rmdir ios
fi

bunx expo prebuild --platform ios --no-install "$@"
