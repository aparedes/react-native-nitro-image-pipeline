#!/usr/bin/env bash
#
# SwiftLint wrapper for the lefthook hooks.
#
# SwiftLint loads SourceKit, which ships inside Xcode but *not* inside the
# Command Line Tools. If `xcode-select -p` points at the CLT (a common setup),
# SwiftLint aborts with a dlopen failure instead of a useful message, so resolve
# a real Xcode toolchain before invoking it.
#
# Usage: scripts/hooks/swiftlint.sh [file ...]
#   With no arguments SwiftLint lints the paths listed under `included:` in
#   .swiftlint.yml.

set -euo pipefail

if ! command -v swiftlint >/dev/null 2>&1; then
  echo "swiftlint not found — skipping. Install with: brew install swiftlint"
  exit 0
fi

if [ ! -d "$(xcode-select -p 2>/dev/null)/Toolchains" ]; then
  for candidate in /Applications/Xcode*.app; do
    if [ -d "$candidate/Contents/Developer/Toolchains" ]; then
      export DEVELOPER_DIR="$candidate/Contents/Developer"
      break
    fi
  done
fi

if [ -z "${DEVELOPER_DIR:-}" ] && [ ! -d "$(xcode-select -p 2>/dev/null)/Toolchains" ]; then
  echo "No Xcode toolchain found — skipping swiftlint (Command Line Tools alone can't run it)."
  exit 0
fi

exec swiftlint lint --quiet --strict "$@"
