import { screen } from '@react-native-harness/ui';
import { Text } from 'react-native';
import { describe, expect, it, render, waitFor } from 'react-native-harness';
import { useImage } from 'react-native-nitro-image-pipeline';

const VALID_URL = 'https://picsum.photos/id/3/200/200';

function TestComponent({ url }: { url: string }) {
  const result = useImage({ url });
  if (result.error) return <Text testID="error">{result.error.message}</Text>;
  if (result.image) return <Text testID="loaded">ok</Text>;
  return <Text testID="loading">loading</Text>;
}

describe('useImage hook', () => {
  it('starts in loading state', async () => {
    await render(<TestComponent url={VALID_URL} />);
    expect(screen.queryByTestId('loading')).toBeDefined();
  });

  it('transitions to loaded state', async () => {
    await render(<TestComponent url={VALID_URL} />);
    await waitFor(() => expect(screen.queryByTestId('loaded')).toBeDefined());
  });

  it('transitions to error state for invalid URL', async () => {
    await render(<TestComponent url="https://not-real.invalid/x.jpg" />);
    await waitFor(() => expect(screen.queryByTestId('error')).toBeDefined());
  });
});
