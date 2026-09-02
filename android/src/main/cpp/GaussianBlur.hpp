//
//  GaussianBlur.hpp
//  NitroImagePipeline
//
//  Cross-platform Gaussian blur — the Android kernel, a port of
//  ios/GaussianBlur.swift.
//
//  This file deliberately depends on nothing but the C and C++ standard
//  libraries (no JNI, no Android headers) so `scripts/verify-blur.swift` can
//  compile it on the host and measure it against the iOS kernel. The JNI
//  glue lives in GaussianBlurJni.cpp.
//
//  `sigma` is the standard deviation of the Gaussian, measured in *source
//  image pixels* — the same sigma applied to the same source file produces
//  the same result on iOS and Android. See the Swift file for why it is a
//  sigma and not a "radius".
//

#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Number of box-blur passes; both platforms run three.
#define NITRO_BLUR_PASSES 3

/// Widths for the three box-blur passes that approximate a Gaussian of
/// `sigma` — the same numbers `GaussianBlur.boxSizes(forSigma:)` returns on
/// iOS. Every width is odd and at least 1.
void nitro_blur_box_sizes(double sigma, uint32_t boxes[NITRO_BLUR_PASSES]);

/// Blurs `pixels` in place with the box widths for `sigma`.
///
/// The buffer is `height` rows of `width` 4-byte pixels, rows `stride` bytes
/// apart. All four channels are convolved identically, so the byte order
/// (ARGB on iOS, RGBA on Android) does not matter — but alpha must be
/// premultiplied, otherwise transparent edges bleed dark halos into the blur.
/// The image edges are clamped (each border pixel extends outward), matching
/// vImage's kvImageEdgeExtend, so blurred images keep their borders instead
/// of fading out into transparent black.
///
/// Returns 0 on success, or -1 if the scratch memory could not be allocated.
int nitro_blur_premultiplied_8888(
    uint8_t* pixels, uint32_t width, uint32_t height, size_t stride, double sigma);

#ifdef __cplusplus
}
#endif
