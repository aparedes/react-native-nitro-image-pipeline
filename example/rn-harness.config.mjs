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
