import type React from 'react';
import { Suspense, use, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { type Image, NitroImage } from 'react-native-nitro-image';
import {
  NativePipelineImage,
  PipelineImage,
  NitroImagePipeline,
  resizeForStyle,
} from 'react-native-nitro-image-pipeline';

// The direct pixel-based `loadImage` call below still needs the screen scale
// to convert its resize/cornerRadius options (in bitmap pixels) from the
// display size (styles.image, in points); <PipelineImage> handles this
// conversion internally so it doesn't need `px`.
const px = PixelRatio.get();

function App({ img2 }: { img2: Promise<Image> }): React.JSX.Element {
  console.log('app');
  const image2 = use(img2);
  const [blur, setBlur] = useState(0);

  return (
    <View style={styles.container}>
      <Text style={styles.text} onPress={() => setBlur((b) => b + 10)}>
        {'hello'}
      </Text>
      <PipelineImage
        url="https://picsum.photos/id/3/5000/3333"
        blur={blur}
        style={styles.image}
        // "Ticket" shape, in points — the component sizes the bitmap to the layout
        cornerRadius={{
          topLeft: 24,
          topRight: 24,
          bottomLeft: 80,
          bottomRight: 80,
        }}
      />
      {image2 && <NitroImage image={image2} style={styles.image} />}
      {/* Fully native-driven: the view measures itself and loads natively —
          no onLayout round trip, no JS work after this render. Rounding
          comes from the style's borderRadius. */}
      <NativePipelineImage
        url="https://picsum.photos/id/1015/4000/3000"
        style={styles.nativeImage}
      />
    </View>
  );
}

const colors = {
  text: 'green',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 40,
    color: colors.text,
  },
  image: {
    width: 300,
    height: 200,
  },
  nativeImage: {
    width: 300,
    height: 100,
    borderRadius: 24,
  },
});

export default () => {
  const img2 = NitroImagePipeline.loadImage(
    'https://picsum.photos/id/100/5000/3333',
    {
      blur: 0,
      // Without `resize` the radii would be baked into the 5000px-wide source
      // and shrink to ~4pt/14pt once it's drawn at 300x200pt.
      resize: resizeForStyle(styles.image),
      cornerRadius: {
        topLeft: 24 * px,
        topRight: 24 * px,
        bottomLeft: 80 * px,
        bottomRight: 80 * px,
      },
    },
  );
  return (
    <Suspense fallback={<Text>Loading...</Text>}>
      <App img2={img2}></App>
    </Suspense>
  );
};
