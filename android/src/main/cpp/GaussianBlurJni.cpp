//
//  GaussianBlurJni.cpp
//  NitroImagePipeline
//
//  JNI entry point for the blur kernel, called from
//  transform/BlurTransformation.kt with a mutable ARGB_8888 bitmap.
//

#include <android/bitmap.h>
#include <android/log.h>
#include <jni.h>

#include "GaussianBlur.hpp"

namespace {
constexpr const char* kTag = "NitroImagePipeline";
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_nitroimagepipeline_transform_BlurTransformation_nativeBlur(
    JNIEnv* env, jclass, jobject bitmap, jfloat sigma) {
  AndroidBitmapInfo info;
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "blur: AndroidBitmap_getInfo failed");
    return JNI_FALSE;
  }
  if (info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "blur: expected an ARGB_8888 bitmap (RGBA_8888 to the NDK), got NDK format %d",
        info.format);
    return JNI_FALSE;
  }

  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS ||
      pixels == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "blur: AndroidBitmap_lockPixels failed");
    return JNI_FALSE;
  }
  const int result = nitro_blur_premultiplied_8888(
      static_cast<uint8_t*>(pixels), info.width, info.height, info.stride, sigma);
  AndroidBitmap_unlockPixels(env, bitmap);
  if (result != 0) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "blur: out of memory for the scratch buffers");
    return JNI_FALSE;
  }
  return JNI_TRUE;
}
