#!/bin/sh
#
# Compiles both blur kernels for the host and runs scripts/verify-blur.swift
# against them. Invoked by `bun run verify:blur` (macOS + Xcode).
#
set -eu
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/nitro-verify-blur"

clang++ -O2 -std=c++20 -Wall -Wextra -c android/src/main/cpp/GaussianBlur.cpp -o "$out-android.o"
swiftc -O -import-objc-header scripts/verify-blur-bridge.h \
  -o "$out" scripts/verify-blur.swift ios/GaussianBlur.swift "$out-android.o" -lc++
"$out"
