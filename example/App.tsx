import type React from 'react';
import { Suspense, use, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Image, NitroImage } from 'react-native-nitro-image';
import {
  NitroImagePipeline,
  useImage,
} from 'react-native-nitro-image-pipeline';

function App({ img2 }: { img2: Promise<Image> }): React.JSX.Element {
  console.log('app');
  const image2 = use(img2);
  const [blur, setBlur] = useState(0);
  const image = useImage({
    url: 'https://picsum.photos/id/3/5000/3333',
    blur: blur,
    // "Ticket" shape: per-corner radii baked into the bitmap
    cornerRadius: {
      topLeft: 24,
      topRight: 24,
      bottomLeft: 80,
      bottomRight: 80,
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
