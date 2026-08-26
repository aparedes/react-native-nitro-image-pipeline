import type React from 'react';
import { Suspense, use, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { type Image, NitroImage } from 'react-native-nitro-image';
import {
  NitroImagePipeline,
  useImage,
} from 'react-native-nitro-image-pipeline';

function App({ img2 }: { img2: Promise<Image> }): React.JSX.Element {
  console.log('app');
  const image2 = use(img2);
  const [blur, setBlur] = useState(0);
  // resize/cornerRadius are in pixels of the produced bitmap; multiply the
  // display size (styles.image, in points) by the screen scale so the ticket
  // corners come out at 24pt/80pt on screen instead of vanishing into the
  // 5000px-wide source.
  const px = PixelRatio.get();
  const image = useImage({
    url: 'https://picsum.photos/id/3/5000/3333',
    blur: blur,
    resize: { width: 300 * px, height: 200 * px },
    // "Ticket" shape: per-corner radii baked into the bitmap
    cornerRadius: {
      topLeft: 24 * px,
      topRight: 24 * px,
      bottomLeft: 80 * px,
      bottomRight: 80 * px,
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.text} onPress={() => setBlur((b) => b + 10)}>
        {'hello'}
      </Text>
      {image.image && <NitroImage image={image.image} style={styles.image} />}
      {image2 && <NitroImage image={image2} style={styles.image} />}
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
});

export default () => {
  const img2 = NitroImagePipeline.loadImage(
    'https://picsum.photos/id/100/5000/3333',
    { blur: 0 },
  );
  return (
    <Suspense fallback={<Text>Loading...</Text>}>
      <App img2={img2}></App>
    </Suspense>
  );
};
