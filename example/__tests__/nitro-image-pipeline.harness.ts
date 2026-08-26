import { beforeAll, describe, expect, it } from 'react-native-harness';
import { NitroImagePipeline } from 'react-native-nitro-image-pipeline';

const VALID_URL = 'https://picsum.photos/id/3/200/200';
const INVALID_URL = 'https://not-a-real-url.invalid/image.jpg';

describe('NitroImagePipeline', () => {
  beforeAll(async () => {
    await NitroImagePipeline.clearCache();
  });

  it('loads an image from a valid URL', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL);
    expect(image).toBeDefined();
  });

  it('applies blur option', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, { blur: 5 });
    expect(image).toBeDefined();
  });

  it('applies a large blur without throwing', async () => {
    // sigma is unbounded now; Android used to reject anything over 25.
    const image = await NitroImagePipeline.loadImage(VALID_URL, { blur: 40 });
    expect(image).toBeDefined();
  });

  it('applies cornerRadius option', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      cornerRadius: 10,
    });
    expect(image).toBeDefined();
  });

  it('resizes to the exact requested pixel size', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      resize: { width: 120, height: 80 },
    });
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('upscales smaller sources when resizing', async () => {
    // Source is 200×200; aspect-fill must upscale to cover 300×400.
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      resize: { width: 300, height: 400 },
    });
    expect(image.width).toBe(300);
    expect(image.height).toBe(400);
  });

  it('applies cornerRadius in resized-bitmap pixels', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      resize: { width: 120, height: 80 },
      cornerRadius: {
        topLeft: 12,
        topRight: 12,
        bottomLeft: 40,
        bottomRight: 40,
      },
    });
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('respects cache: none', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      cache: 'none',
    });
    expect(image).toBeDefined();
  });

  it('respects cache: disk', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      cache: 'disk',
    });
    expect(image).toBeDefined();
  });

  it('respects cache: memory', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      cache: 'memory',
    });
    expect(image).toBeDefined();
  });

  it('preloads a single image', async () => {
    await expect(
      NitroImagePipeline.preLoadImage(VALID_URL),
    ).resolves.toBeUndefined();
  });

  it('preloads multiple images', async () => {
    const urls = [VALID_URL, 'https://picsum.photos/id/10/200/200'];
    await expect(
      NitroImagePipeline.preLoadImages(urls),
    ).resolves.toBeUndefined();
  });

  it('applies gaussian blur to a loaded image', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL);
    const blurred = await NitroImagePipeline.gaussianBlur(image, 3);
    expect(blurred).toBeDefined();
  });

  it('keeps the source dimensions when blurring', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL);
    // A large sigma makes Android blur a downscaled copy internally; the
    // result still has to come back at the original size.
    const blurred = await NitroImagePipeline.gaussianBlur(image, 30);
    expect(blurred.width).toBe(image.width);
    expect(blurred.height).toBe(image.height);
  });

  it('clears cache without throwing', async () => {
    await expect(NitroImagePipeline.clearCache()).resolves.toBeUndefined();
  });

  it('rejects with an error for an invalid URL', async () => {
    await expect(NitroImagePipeline.loadImage(INVALID_URL)).rejects.toThrow();
  });
});
