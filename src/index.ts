import { NitroModules } from 'react-native-nitro-modules';
import type { NitroImageToolkit as NitroImageToolkitSpec } from './specs/nitro-image-toolkit.nitro';

export const NitroImageToolkit =
  NitroModules.createHybridObject<NitroImageToolkitSpec>('NitroImageToolkit');
