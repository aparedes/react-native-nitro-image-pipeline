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

/// One box pass of width `box` over the whole image, in place.
///
/// `rowSums` caches the horizontal running sums of the rows the vertical
/// window currently covers (a ring of `ring` rows), so each row's horizontal
/// pass runs once. The image edges are clamped: sampling outside the image
/// returns the nearest border pixel, exactly like vImage's kvImageEdgeExtend.
void boxPass(
    uint8_t* pixels,
    uint32_t width,
    uint32_t height,
    size_t stride,
    uint32_t box,
    std::vector<uint32_t>& rowSums,
    std::vector<int64_t>& rowIndex,
    std::vector<uint64_t>& column) {
  const int64_t radius = (static_cast<int64_t>(box) - 1) / 2;
  const int64_t w = width;
  const int64_t h = height;
  const size_t rowLength = static_cast<size_t>(width) * kChannels;
  const int64_t ring = std::min<int64_t>(box, h) + 1;
  const uint64_t area = static_cast<uint64_t>(box) * box;
  const uint64_t half = area / 2;

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
  std::fill(column.begin(), column.end(), 0);
  for (int64_t dy = -radius; dy <= radius; dy++) {
    const uint32_t* r = horizontal(clampRow(dy));
    for (size_t i = 0; i < rowLength; i++) column[i] += r[i];
  }

  for (int64_t y = 0; y < h; y++) {
    uint8_t* out = pixels + static_cast<size_t>(y) * stride;
    for (size_t i = 0; i < rowLength; i++) {
      out[i] = static_cast<uint8_t>((column[i] + half) / area);
    }
    if (y + 1 == h) break;
    // The row leaving the window is still cached: it is inside the window,
    // and the ring holds one row more than the window can span.
    const uint32_t* leaving = horizontal(clampRow(y - radius));
    const uint32_t* entering = horizontal(clampRow(y + radius + 1));
    // Two steps: a uint32 `entering - leaving` would wrap before it reached
    // the 64-bit accumulator.
    for (size_t i = 0; i < rowLength; i++) column[i] += entering[i];
    for (size_t i = 0; i < rowLength; i++) column[i] -= leaving[i];
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
  const size_t rowLength = static_cast<size_t>(width) * kChannels;
  const size_t ring = std::min<size_t>(widest, height) + 1;
  try {
    std::vector<uint32_t> rowSums(ring * rowLength);
    std::vector<int64_t> rowIndex(ring);
    std::vector<uint64_t> column(rowLength);
    for (int i = 0; i < NITRO_BLUR_PASSES; i++) {
      boxPass(pixels, width, height, stride, boxes[i], rowSums, rowIndex, column);
    }
  } catch (const std::bad_alloc&) {
    return -1;
  }
  return 0;
}
