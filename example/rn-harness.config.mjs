import {
  androidEmulator,
  androidPlatform,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroImagePipelineExample',

  // Every suite here does live network fetches (picsum.photos) on a freshly
  // booted CI simulator; the first cold fetch (DNS + TLS + redirect) can
  // exceed the 5s default, so give network-bound tests more headroom.
  testTimeout: 30000,

  // Booting the iPhone simulator on a cold GitHub macOS runner has taken
  // longer than the 5-minute default more than once, failing the job before
  // a single test ran. Ten minutes covers the slow boots seen so far.
  platformReadyTimeout: 600000,

  runners: [
    androidPlatform({
      name: 'medium_phone_api_36.1',
      device: androidEmulator('Medium_Phone_API_36.1'),
      bundleId: 'com.nitroimagepipelineexample',
    }),
    applePlatform({
      name: 'iphone-17',
      device: appleSimulator('iPhone 17', '26.4'),
      bundleId: 'com.nitroimagepipelineexample',
    }),
  ],
  defaultRunner: 'medium_phone_api_36.1',
};
