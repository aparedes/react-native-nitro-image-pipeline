import { beforeAll, describe, expect, it } from 'react-native-harness';
import { NitroImagePipeline } from 'react-native-nitro-image-pipeline';

const VALID_URL = 'https://picsum.photos/id/3/200/200';
const INVALID_URL = 'https://not-a-real-url.invalid/image.jpg';

describe('NitroImagePipeline', () => {
  beforeAll(() => {
    NitroImagePipeline.clearCache();
  });

  it('loads an image from a valid URL', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL);
    expect(image).toBeDefined();
  });

  it('applies blur option', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, { blur: 5 });
    expect(image).toBeDefined();
  });

  it('applies cornerRadius option', async () => {
    const image = await NitroImagePipeline.loadImage(VALID_URL, {
      cornerRadius: 10,
    });
    expect(image).toBeDefined();
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

  it('clears cache without throwing', () => {
    expect(() => NitroImagePipeline.clearCache()).not.toThrow();
  });

  it('rejects with an error for an invalid URL', async () => {
    await expect(NitroImagePipeline.loadImage(INVALID_URL)).rejects.toThrow();
  });
});
