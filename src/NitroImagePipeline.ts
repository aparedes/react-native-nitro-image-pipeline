import { NitroModules } from 'react-native-nitro-modules';

import type { NitroImagePipeline as NitroImagePipelineSpec } from './specs/nitro-image-toolkit.nitro';

export const NitroImagePipeline =
  NitroModules.createHybridObject<NitroImagePipelineSpec>('NitroImagePipeline');
