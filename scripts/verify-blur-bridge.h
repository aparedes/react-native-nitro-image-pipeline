// Bridging header for scripts/verify-blur.swift: exposes the Android blur
// kernel's C API to Swift so the host-side check can run both kernels.
#include "../android/src/main/cpp/GaussianBlur.hpp"
