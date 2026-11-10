//
//  verify-blur-reference.cpp
//
//  Host-side check of android/src/main/cpp/GaussianBlur.cpp against the
//  definition of what it computes — the first step of `bun run verify:blur`.
//
//  The kernel takes a window's mean one of two ways: by multiplying with a
//  reciprocal (every realistic sigma) or, for boxes too wide for that, by
//  dividing. verify-blur.swift compares it with vImage at everyday sigmas,
//  which only ever reaches the first. This runs both — and the running sums
//  around them — against a reference with no running sums and one plain
//  division: every output byte is the clamped window summed sample by sample,
//  `(sum + area / 2) / area`. The images are small enough for that to be
//  instant; the boxes go far past them, as they do when a strong blur meets a
//  thumbnail.
//
//  Needs nothing but a C++ compiler, so unlike the rest of `verify:blur` it
//  also runs off macOS — compile this file together with GaussianBlur.cpp
//  (`-std=c++20`) and run the result.
//

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

#include "../android/src/main/cpp/GaussianBlur.hpp"

namespace {

constexpr int kChannels = 4;

/// How often each of `size` samples falls inside the `box`-wide window
/// centred on `center`, with samples outside the image clamped to its border.
std::vector<uint64_t> windowWeights(int64_t center, int64_t size, uint32_t box) {
  const int64_t radius = (static_cast<int64_t>(box) - 1) / 2;
  std::vector<uint64_t> weights(static_cast<size_t>(size), 0);
  for (int64_t offset = -radius; offset <= radius; offset++) {
    weights[static_cast<size_t>(std::clamp<int64_t>(center + offset, 0, size - 1))]++;
  }
  return weights;
}

/// One box pass, by definition. Rows are `stride` bytes apart; the bytes past
/// `width` pixels are left alone.
void referencePass(
    std::vector<uint8_t>& pixels, uint32_t width, uint32_t height, size_t stride, uint32_t box) {
  const uint64_t area = static_cast<uint64_t>(box) * box;
  std::vector<std::vector<uint64_t>> columnWeights;
  for (uint32_t x = 0; x < width; x++) columnWeights.push_back(windowWeights(x, width, box));

  const std::vector<uint8_t> source = pixels;
  for (uint32_t y = 0; y < height; y++) {
    const std::vector<uint64_t> rowWeights = windowWeights(y, height, box);
    for (uint32_t x = 0; x < width; x++) {
      uint64_t sums[kChannels] = {0, 0, 0, 0};
      for (uint32_t sy = 0; sy < height; sy++) {
        for (uint32_t sx = 0; sx < width; sx++) {
          const uint64_t weight = rowWeights[sy] * columnWeights[x][sx];
          const uint8_t* sample = &source[sy * stride + static_cast<size_t>(sx) * kChannels];
          for (int c = 0; c < kChannels; c++) sums[c] += weight * sample[c];
        }
      }
      uint8_t* out = &pixels[y * stride + static_cast<size_t>(x) * kChannels];
      for (int c = 0; c < kChannels; c++) {
        out[c] = static_cast<uint8_t>((sums[c] + area / 2) / area);
      }
    }
  }
}

struct Size {
  uint32_t width;
  uint32_t height;
};

}  // namespace

int main() {
  // Single rows, columns and pixels are where the clamping is all there is.
  const Size sizes[] = {{1, 1}, {1, 9}, {9, 1}, {5, 7}, {33, 17}, {40, 24}};
  // 1447 and 1449 sit either side of the widest box the reciprocal handles
  // (2895); 3000 is well past it. 0.2 is too small to blur at all.
  const double sigmas[] = {0.2, 0.5, 1, 3, 8, 20, 40, 400, 1447, 1449, 3000};
  const char* const contents[] = {"noise", "white", "sparse"};

  std::mt19937 random(20260410);
  int blurs = 0;
  int failures = 0;
  uint32_t narrowest = UINT32_MAX;
  uint32_t widest = 0;

  for (const Size& size : sizes) {
    // Row padding, as a bitmap's stride may have: it must come back untouched.
    for (const size_t padding : {size_t{0}, size_t{12}}) {
      const size_t stride = static_cast<size_t>(size.width) * kChannels + padding;
      for (const char* content : contents) {
        std::vector<uint8_t> source(stride * size.height);
        for (uint8_t& byte : source) {
          switch (content[0]) {
            case 'n':
              byte = static_cast<uint8_t>(random());
              break;
            case 'w':
              // The largest sums a window can hold.
              byte = 255;
              break;
            default:
              byte = random() % 8 == 0 ? 255 : 0;
              break;
          }
        }

        for (const double sigma : sigmas) {
          uint32_t boxes[NITRO_BLUR_PASSES];
          nitro_blur_box_sizes(sigma, boxes);

          std::vector<uint8_t> expected = source;
          for (const uint32_t box : boxes) {
            narrowest = std::min(narrowest, box);
            widest = std::max(widest, box);
            referencePass(expected, size.width, size.height, stride, box);
          }

          std::vector<uint8_t> actual = source;
          const int status = nitro_blur_premultiplied_8888(
              actual.data(), size.width, size.height, stride, sigma);
          blurs++;
          if (status == 0 && actual == expected) continue;

          failures++;
          size_t differing = 0;
          for (size_t i = 0; i < actual.size(); i++) differing += actual[i] != expected[i];
          std::printf(
              "FAILED: %ux%u (+%zu stride) %s, sigma %g, boxes [%u, %u, %u]: status %d, "
              "%zu of %zu bytes differ\n",
              size.width, size.height, padding, content, sigma, boxes[0], boxes[1], boxes[2],
              status, differing, actual.size());
        }
      }
    }
  }

  // The point of the sigmas above; a change to the box search that stopped
  // reaching either side of the reciprocal's limit should say so here.
  if (narrowest != 1 || widest <= 2895) {
    failures++;
    std::printf("FAILED: boxes only span %u…%u — both means are no longer covered\n", narrowest, widest);
  }

  std::printf(
      "Android kernel vs. a naive reference: %d blurs, boxes %u…%u wide, %d failed.\n",
      blurs, narrowest, widest, failures);
  return failures == 0 ? 0 : 1;
}
