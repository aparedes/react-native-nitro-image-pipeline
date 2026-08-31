import { screen } from '@react-native-harness/ui';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { describe, expect, it, render, waitFor } from 'react-native-harness';
import { useImage } from 'react-native-nitro-image-pipeline';

import { GRADIENT_URL as VALID_URL } from './fixture-urls';

function TestComponent({ url, enabled }: { url: string; enabled?: boolean }) {
  const result = useImage({ url, enabled });
  if (result.error) return <Text testID="error">{result.error.message}</Text>;
  if (result.image) return <Text testID="loaded">ok</Text>;
  return <Text testID="loading">loading</Text>;
}

function EnabledAfterDelay({ url }: { url: string }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEnabled(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return <TestComponent url={url} enabled={enabled} />;
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

  it('does not load while enabled is false', async () => {
    await render(<TestComponent url={VALID_URL} enabled={false} />);
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.queryByTestId('loading')).toBeDefined();
    expect(screen.queryByTestId('loaded')).toBeNull();
  });

  it('loads once enabled flips to true', async () => {
    await render(<EnabledAfterDelay url={VALID_URL} />);
    await waitFor(() => expect(screen.queryByTestId('loaded')).toBeDefined());
  });
});
