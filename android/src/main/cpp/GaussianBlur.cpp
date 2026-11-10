//
//  GaussianBlur.cpp
//  NitroImagePipeline
//
//  See GaussianBlur.hpp. Three box-blur passes approximate the Gaussian;
//  each pass is a separable 2D box (horizontal running sum, then vertical
//  running sum) that rounds to 8 bits only once, so it matches vImage's
//  single 2D `vImageBoxConvolve_ARGB8888` pass on iOS rather than
//  accumulating an extra rounding error per direction.
//

#include "GaussianBlur.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace {

constexpr int kChannels = 4;

/// The standard deviation three box blurs of the given widths add up to.
double standardDeviation(const uint32_t boxes[NITRO_BLUR_PASSES]) {
  double sum = 0;
  for (int i = 0; i < NITRO_BLUR_PASSES; i++) {
    const double width = boxes[i];
    sum += width * width - 1;
  }
  return std::sqrt(sum / 12);
}

/// The rounded mean of a window, `(sum + area / 2) / area`, without dividing:
/// `((sum + half) * multiplier) >> shift`. A pass takes that mean once per
/// channel per pixel, and an integer division there is most of what the pass
/// costs — it can't be vectorised, and a 64-bit one is a library call on
/// 32-bit ARM — while the widening multiply is a single SIMD instruction.
///
/// The result is the division's, bit for bit. With `d = area` and every
/// dividend `n <= N = 255 * d + d / 2`: `shift` is picked so that
/// `2^shift > N * d`, and `multiplier = 2^shift / d + 1`, which makes
/// `multiplier * d = 2^shift + e` with `0 < e <= d`. Then
/// `n * multiplier / 2^shift = n / d + n * e / (d * 2^shift)`, and that last
/// term is below `1 / d` (as `n * e <= N * d < 2^shift`) — too small to carry
/// `n / d`, whose fraction is at most `(d - 1) / d`, to the next integer.
struct ReciprocalMean {
  using Sum = uint32_t;

  /// Whether every operand fits 32 bits for `area`: below 2^23 the largest
  /// dividend, `255 * area + area / 2`, is below 2^31, and the multiplier —
  /// at most twice that, plus one — below 2^32. That covers boxes up to 2895
  /// wide, i.e. any sigma up to ~1447.
  static bool fits(uint64_t area) { return area < (uint64_t{1} << 23); }

  explicit ReciprocalMean(uint64_t area) : half(static_cast<uint32_t>(area / 2)) {
    const uint64_t largest = 255 * area + area / 2;
    shift = 0;
    while ((uint64_t{1} << shift) <= largest * area) shift++;
    multiplier = static_cast<uint32_t>((uint64_t{1} << shift) / area + 1);
  }

  uint8_t operator()(uint32_t sum) const {
    return static_cast<uint8_t>((static_cast<uint64_t>(sum + half) * multiplier) >> shift);
  }

  uint32_t half;
  uint32_t multiplier;
  uint32_t shift;
};

/// The same mean by division, for a box too wide for `ReciprocalMean`: its
/// sums no longer fit 32 bits either.
struct DividedMean {
  using Sum = uint64_t;

  explicit DividedMean(uint64_t area) : half(area / 2), area(area) {}

  uint8_t operator()(uint64_t sum) const { return static_cast<uint8_t>((sum + half) / area); }

  uint64_t half;
  uint64_t area;
};

/// One box pass of width `box` over the whole image, in place. `mean` — a
/// `ReciprocalMean` or a `DividedMean` for the box's area — turns a window sum
/// into the output byte, and its `Sum` is the type the window sums are
/// accumulated in (`column`, one per channel per image column).
///
/// `rowSums` caches the horizontal running sums of the rows the vertical
/// window currently covers (a ring of `ring` rows), so each row's horizontal
/// pass runs once. The image edges are clamped: sampling outside the image
/// returns the nearest border pixel, exactly like vImage's kvImageEdgeExtend.
template <typename Mean>
void boxPass(
    uint8_t* pixels,
    uint32_t width,
    uint32_t height,
    size_t stride,
    uint32_t box,
    // By value, like `column` below: `out` is a byte pointer, which may alias
    // anything it can reach, and a mean or an accumulator the compiler has to
    // reload after every store keeps the output loop from being vectorised.
    const Mean mean,
    std::vector<uint32_t>& rowSums,
    std::vector<int64_t>& rowIndex,
    std::vector<typename Mean::Sum>& columnSums) {
  const int64_t radius = (static_cast<int64_t>(box) - 1) / 2;
  const int64_t w = width;
  const int64_t h = height;
  const size_t rowLength = static_cast<size_t>(width) * kChannels;
  const int64_t ring = std::min<int64_t>(box, h) + 1;
  typename Mean::Sum* const column = columnSums.data();

  std::fill(rowIndex.begin(), rowIndex.end(), -1);

  auto clampRow = [h](int64_t y) { return std::max<int64_t>(0, std::min(h - 1, y)); };

  // Horizontal running sum of image row `y` into the ring slot for it.
  auto horizontal = [&](int64_t y) -> const uint32_t* {
    const int64_t slot = y % ring;
    uint32_t* out = rowSums.data() + static_cast<size_t>(slot) * rowLength;
    if (rowIndex[static_cast<size_t>(slot)] == y) return out;
    rowIndex[static_cast<size_t>(slot)] = y;

    const uint8_t* row = pixels + static_cast<size_t>(y) * stride;
    auto px = [&](int64_t x) {
      return row + static_cast<size_t>(std::max<int64_t>(0, std::min(w - 1, x))) * kChannels;
    };
    uint32_t sum[kChannels] = {0, 0, 0, 0};
    for (int64_t dx = -radius; dx <= radius; dx++) {
      const uint8_t* p = px(dx);
      for (int c = 0; c < kChannels; c++) sum[c] += p[c];
    }
    for (int64_t x = 0; x < w; x++) {
      for (int c = 0; c < kChannels; c++) out[x * kChannels + c] = sum[c];
      const uint8_t* leaving = px(x - radius);
      const uint8_t* entering = px(x + radius + 1);
      for (int c = 0; c < kChannels; c++) sum[c] += entering[c] - leaving[c];
    }
    return out;
  };

  // Vertical running sum over the clamped window [y - radius, y + radius].
  std::fill(column, column + rowLength, 0);
  for (int64_t dy = -radius; dy <= radius; dy++) {
    const uint32_t* r = horizontal(clampRow(dy));
    for (size_t i = 0; i < rowLength; i++) column[i] += r[i];
  }

  for (int64_t y = 0; y < h; y++) {
    uint8_t* out = pixels + static_cast<size_t>(y) * stride;
    for (size_t i = 0; i < rowLength; i++) out[i] = mean(column[i]);
    if (y + 1 == h) break;
    // The row leaving the window is still cached: it is inside the window,
    // and the ring holds one row more than the window can span.
    const uint32_t* leaving = horizontal(clampRow(y - radius));
    const uint32_t* entering = horizontal(clampRow(y + radius + 1));
    // Added before it is subtracted: a uint32 `entering - leaving` would wrap
    // before it reached a 64-bit accumulator. (A 32-bit one wraps on the way
    // up and back on the way down, which is exact.)
    for (size_t i = 0; i < rowLength; i++) column[i] = column[i] + entering[i] - leaving[i];
  }
}

}  // namespace

extern "C" void nitro_blur_box_sizes(double sigma, uint32_t boxes[NITRO_BLUR_PASSES]) {
  // Three boxes of widths w1…w3 produce a standard deviation of
  // sqrt((w1² + w2² + w3² - 3) / 12). Box widths have to be odd, so the
  // passes are split between the two odd integers straddling the ideal width
  // and the split landing closest to `sigma` wins — the same search as
  // `GaussianBlur.boxSizes(forSigma:)` on iOS, so both platforms pick the
  // same widths.
  const int passes = NITRO_BLUR_PASSES;
  // A NaN or infinite sigma would make every candidate's error NaN and
  // leave `boxes` unwritten; treat it, and sigma <= 0, as "no blur".
  if (!std::isfinite(sigma) || sigma <= 0) {
    for (int i = 0; i < passes; i++) boxes[i] = 1;
    return;
  }
  int64_t lower = static_cast<int64_t>(std::sqrt((12 * sigma * sigma / passes) + 1));
  if (lower % 2 == 0) lower -= 1;
  lower = std::min<int64_t>(std::max<int64_t>(lower, 1), static_cast<int64_t>(UINT32_MAX) - 2);
  const int64_t upper = lower + 2;

  double bestError = INFINITY;
  for (int lowerCount = 0; lowerCount <= passes; lowerCount++) {
    uint32_t candidate[NITRO_BLUR_PASSES];
    for (int pass = 0; pass < passes; pass++) {
      candidate[pass] = static_cast<uint32_t>(pass < lowerCount ? lower : upper);
    }
    const double error = std::fabs(standardDeviation(candidate) - sigma);
    if (error < bestError) {
      bestError = error;
      std::memcpy(boxes, candidate, sizeof(candidate));
    }
  }
}

extern "C" int nitro_blur_premultiplied_8888(
    uint8_t* pixels, uint32_t width, uint32_t height, size_t stride, double sigma) {
  if (width == 0 || height == 0) return 0;
  uint32_t boxes[NITRO_BLUR_PASSES];
  nitro_blur_box_sizes(sigma, boxes);

  // Size the scratch buffers for the widest pass so every pass fits in them.
  const uint32_t widest = *std::max_element(boxes, boxes + NITRO_BLUR_PASSES);
  // A sigma too small to affect a pixel: nothing to allocate or compute.
  if (widest == 1) return 0;
  const size_t rowLength = static_cast<size_t>(width) * kChannels;
  const size_t ring = std::min<size_t>(widest, height) + 1;
  try {
    std::vector<uint32_t> rowSums(ring * rowLength);
    std::vector<int64_t> rowIndex(ring);
    // Sized on first use: all but the most extreme sigmas only need `sums`.
    std::vector<ReciprocalMean::Sum> sums;
    std::vector<DividedMean::Sum> wideSums;
    for (int i = 0; i < NITRO_BLUR_PASSES; i++) {
      const uint32_t box = boxes[i];
      // A box one pixel wide is the identity.
      if (box == 1) continue;
      const uint64_t area = static_cast<uint64_t>(box) * box;
      if (ReciprocalMean::fits(area)) {
        sums.resize(rowLength);
        boxPass(pixels, width, height, stride, box, ReciprocalMean(area), rowSums, rowIndex, sums);
      } else {
        wideSums.resize(rowLength);
        boxPass(
            pixels, width, height, stride, box, DividedMean(area), rowSums, rowIndex, wideSums);
      }
    }
  } catch (const std::bad_alloc&) {
    return -1;
  }
  return 0;
}
