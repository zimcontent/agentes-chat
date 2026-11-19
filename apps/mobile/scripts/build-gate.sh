#!/usr/bin/env bash
# The phone app's checks before a build compiles anything: its unit tests, its types, and the native packages
# against the Expo SDK. A red check stops the build here, in a minute, instead of a TestFlight build that freezes
# or dies at launch on someone's phone.
#
# EAS runs it after installing (the `eas-build-post-install` hook in apps/mobile/package.json) on every profile but
# `development`. By hand: `bun run mobile:check` (`bun run mobile:check --bundle` also makes the iOS bundle and
# compiles it to Hermes bytecode, as the build does).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"

if [ "${EAS_BUILD_PROFILE:-}" = "development" ]; then
  echo "build gate: skipped for the development client"
  exit 0
fi

step() {
  local name=$1
  shift
  local t0=$SECONDS
  echo "build gate: $name"
  if ! "$@"; then
    echo "build gate: FAILED at \"$name\" ($((SECONDS - t0))s). The build stops here." >&2
    exit 1
  fi
  echo "build gate: $name ok ($((SECONDS - t0))s)"
}

cd "$root"
step "unit tests" bun test apps/mobile/test
cd "$here"
step "typecheck" bun run typecheck
# Every native package at the version the SDK pins: a lone bump of one (build 27: `expo` without React Native) links
# against symbols the other doesn't have and the app dies at launch.
step "native packages match the Expo SDK" bun x expo install --check

if [ "${1:-}" = "--bundle" ]; then
  out="$(mktemp -d "${TMPDIR:-/tmp}/dougbot-bundle.XXXXXX")"
  step "iOS bundle compiled to Hermes" env CI=1 APP_VARIANT=production bun x expo export --platform ios --output-dir "$out"
  ls -la "$out"/_expo/static/js/ios/*.hbc
  rm -rf "$out"
fi
