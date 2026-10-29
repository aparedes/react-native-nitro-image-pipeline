import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  type FlatList as FlatListType,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  NativePipelineImage,
  PipelineImage,
} from 'react-native-nitro-image-pipeline';

// A memory stress test: a grid of IMAGE_COUNT distinct 1200x1200 sources,
// each resized to its cell. Opened from App via a deep link, so each variant
// can be measured from a fresh process:
//   adb shell am start -W -a android.intent.action.VIEW \
//     -d 'nitroimagepipeline://stress?component=native&list=flatlist&autoscroll=1'
// With `autoscroll=1` it scrolls to the end one screen at a time and shows
// "scroll: done", so a script knows when to measure.

export type StressComponent = 'pipeline' | 'native';
export type StressList = 'flatlist' | 'scrollview';

export interface StressConfig {
  component: StressComponent;
  list: StressList;
  autoScroll: boolean;
}

const IMAGE_COUNT = 150;
const COLUMNS = 3;
const SCROLL_STEP_MS = 400;
const AUTO_SCROLL_DELAY_MS = 6000;

const urls = Array.from(
  { length: IMAGE_COUNT },
  (_, i) => `https://picsum.photos/seed/stress-${i}/1200/1200`,
);

export function parseStressUrl(url: string | null): StressConfig | undefined {
  if (!url?.startsWith('nitroimagepipeline://stress')) return undefined;
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  return {
    component: params.get('component') === 'pipeline' ? 'pipeline' : 'native',
    list: params.get('list') === 'scrollview' ? 'scrollview' : 'flatlist',
    autoScroll: params.get('autoscroll') === '1',
  };
}

function Cell({
  url,
  size,
  component,
}: {
  url: string;
  size: number;
  component: StressComponent;
}): React.JSX.Element {
  const style = { width: size, height: size };
  return component === 'native' ? (
    <NativePipelineImage url={url} style={style} />
  ) : (
    <PipelineImage url={url} style={style} />
  );
}

type Scroller = Pick<FlatListType<string>, 'scrollToOffset'> | ScrollView;

function scrollTo(scroller: Scroller, offset: number) {
  if ('scrollToOffset' in scroller) {
    scroller.scrollToOffset({ offset, animated: false });
  } else {
    scroller.scrollTo({ y: offset, animated: false });
  }
}

export function StressScreen({
  initial,
}: {
  initial: StressConfig;
}): React.JSX.Element {
  const [config, setConfig] = useState(initial);
  const [scrollState, setScrollState] = useState(
    initial.autoScroll ? 'waiting' : 'idle',
  );
  const { width, height } = useWindowDimensions();
  const size = Math.floor(width / COLUMNS);
  const rows = Math.ceil(IMAGE_COUNT / COLUMNS);
  const contentHeight = rows * size;
  const scroller = useRef<Scroller>(null);

  useEffect(() => {
    if (!config.autoScroll) return;
    let offset = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setScrollState('scrolling');
      interval = setInterval(() => {
        offset = Math.min(offset + height, contentHeight);
        if (scroller.current) scrollTo(scroller.current, offset);
        if (offset >= contentHeight) {
          clearInterval(interval);
          setScrollState('done');
        }
      }, SCROLL_STEP_MS);
    }, AUTO_SCROLL_DELAY_MS);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [config, height, contentHeight]);

  const toggle = (patch: Partial<StressConfig>) =>
    setConfig((c) => ({ ...c, ...patch, autoScroll: false }));

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Text
          style={styles.button}
          onPress={() =>
            toggle({
              component: config.component === 'native' ? 'pipeline' : 'native',
            })
          }
        >
          {config.component}
        </Text>
        <Text
          style={styles.button}
          onPress={() =>
            toggle({
              list: config.list === 'flatlist' ? 'scrollview' : 'flatlist',
            })
          }
        >
          {config.list}
        </Text>
        <Text
          style={styles.button}
          onPress={() => {
            setScrollState('waiting');
            setConfig((c) => ({ ...c, autoScroll: true }));
          }}
        >
          {`scroll: ${scrollState}`}
        </Text>
      </View>
      {config.list === 'flatlist' ? (
        <FlatList
          // Remount on every switch so variants never share views.
          key={`${config.component}-flatlist`}
          ref={(ref) => {
            scroller.current = ref;
          }}
          data={urls}
          numColumns={COLUMNS}
          keyExtractor={(url) => url}
          renderItem={({ item }) => (
            <Cell url={item} size={size} component={config.component} />
          )}
        />
      ) : (
        <ScrollView
          key={`${config.component}-scrollview`}
          ref={(ref) => {
            scroller.current = ref;
          }}
          contentContainerStyle={styles.grid}
        >
          {urls.map((url) => (
            <Cell
              key={url}
              url={url}
              size={size}
              component={config.component}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const colors = {
  link: 'blue',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 48,
    paddingBottom: 8,
  },
  button: {
    fontSize: 16,
    color: colors.link,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
