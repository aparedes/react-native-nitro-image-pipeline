import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
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
// `list=carousel` renders full-width pages placed only by a native-driver
// `translateX` (their layout positions are all identical); `autoscroll=1`
// animates one page at a time.

export type StressComponent = 'pipeline' | 'native';
export type StressList = 'flatlist' | 'scrollview' | 'carousel';

export interface StressConfig {
  component: StressComponent;
  list: StressList;
  autoScroll: boolean;
}

const IMAGE_COUNT = 150;
const COLUMNS = 3;
const SCROLL_STEP_MS = 400;
const AUTO_SCROLL_DELAY_MS = 6000;

const NEXT_LIST: Record<StressList, StressList> = {
  flatlist: 'scrollview',
  scrollview: 'carousel',
  carousel: 'flatlist',
};

const urls = Array.from(
  { length: IMAGE_COUNT },
  (_, i) => `https://picsum.photos/seed/stress-${i}/1200/1200`,
);

export function parseStressUrl(url: string | null): StressConfig | undefined {
  if (!url?.startsWith('nitroimagepipeline://stress')) return undefined;
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  const list = params.get('list');
  return {
    component: params.get('component') === 'pipeline' ? 'pipeline' : 'native',
    list: list === 'scrollview' || list === 'carousel' ? list : 'flatlist',
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

function Carousel({
  component,
  width,
  position,
}: {
  component: StressComponent;
  width: number;
  position: Animated.Value;
}): React.JSX.Element {
  return (
    <View style={styles.carousel}>
      {urls.map((url, i) => {
        const pageStyle = [
          styles.page,
          { transform: [{ translateX: Animated.add(position, i * width) }] },
        ];
        return (
          <Animated.View key={url} style={pageStyle}>
            <Cell url={url} size={width} component={component} />
          </Animated.View>
        );
      })}
    </View>
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
  const [position] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!config.autoScroll) return;
    let offset = 0;
    let page = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setScrollState('scrolling');
      interval = setInterval(() => {
        if (config.list === 'carousel') {
          Animated.timing(position, {
            toValue: -page * width,
            duration: 300,
            useNativeDriver: true,
          }).start();
          if (page >= IMAGE_COUNT - 1) {
            clearInterval(interval);
            setScrollState('done');
          }
          page += 1;
          return;
        }
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
  }, [config, height, contentHeight, width, position]);

  const toggle = (patch: Partial<StressConfig>) => {
    position.setValue(0);
    setConfig((c) => ({ ...c, ...patch, autoScroll: false }));
  };

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
              list: NEXT_LIST[config.list],
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
      {config.list === 'carousel' ? (
        <Carousel
          key={`${config.component}-carousel`}
          component={config.component}
          width={width}
          position={position}
        />
      ) : config.list === 'flatlist' ? (
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
  carousel: {
    flex: 1,
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
