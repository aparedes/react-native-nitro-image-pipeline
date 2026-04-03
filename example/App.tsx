import type React from 'react';
import { Suspense, use, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Image, NitroImage } from 'react-native-nitro-image';
import { NitroImageToolkit, useImage } from 'react-native-nitro-image-toolkit';

function App({ img2 }: { img2: Promise<Image> }): React.JSX.Element {
  console.log('app');
  const image2 = use(img2);
  const [blur, setBlur] = useState(0);
  const image = useImage({
    url: 'https://picsum.photos/id/3/5000/3333',
    blur: 0,
    cornerRadius: 80,
  });

  return (
    <View style={styles.container}>
      <Text style={styles.text} onPress={() => setBlur((b) => b + 10)}>
        {'hello'}
      </Text>
      {image.image && (
        <NitroImage image={image.image} style={{ width: 300, height: 200 }} />
      )}
      {image2 && (
        <NitroImage image={image2} style={{ width: 300, height: 200 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 40,
    color: 'green',
  },
});

export default () => {
  const img2 = NitroImageToolkit.loadImage(
    'https://picsum.photos/id/100/5000/3333',
    { blur: 0 },
  );
  return (
    <Suspense fallback={<Text>Loading...</Text>}>
      <App img2={img2}></App>
    </Suspense>
  );
};
