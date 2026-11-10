#!/bin/sh
#
# Compiles both blur kernels for the host and checks them: the Android one
# against a naive reference (scripts/verify-blur-reference.cpp), then both
# against each other (scripts/verify-blur.swift). Invoked by
# `bun run verify:blur` (macOS + Xcode).
#
set -eu
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/nitro-verify-blur"

clang++ -O2 -std=c++20 -Wall -Wextra -c android/src/main/cpp/GaussianBlur.cpp -o "$out-android.o"
# First, and without Swift: it covers the wide-box path the comparison with
# vImage below never reaches, and fails in a second if the kernel is broken.
clang++ -O2 -std=c++20 -Wall -Wextra scripts/verify-blur-reference.cpp "$out-android.o" \
  -o "$out-reference"
"$out-reference"
echo
swiftc -O -import-objc-header scripts/verify-blur-bridge.h \
  -o "$out" scripts/verify-blur.swift ios/GaussianBlur.swift "$out-android.o" -lc++
"$out"
