import { join } from 'node:path';

const androidOnLoadFile = join(
  process.cwd(),
  'nitrogen/generated/android',
  'NitroImagePipelineOnLoad.cpp',
);

const file = Bun.file(androidOnLoadFile);
const str = await file.text();
await Bun.write(androidOnLoadFile, str.replace(/margelo\/nitro\//g, ''));
