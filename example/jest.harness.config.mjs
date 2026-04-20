export default {
  preset: 'react-native-harness',
  testMatch: ['**/*.harness.[jt]s?(x)'],
  setupFilesAfterEnv: ['./.harness/setup.ts'],
};
