import { describe, test, expect } from 'bun:test';
import { toBackendImageUrl } from './imageUrl';

describe('toBackendImageUrl', () => {
  test('returns null for null, undefined, or empty string', () => {
    expect(toBackendImageUrl(null)).toBeNull();
    expect(toBackendImageUrl(undefined)).toBeNull();
    expect(toBackendImageUrl('')).toBeNull();
  });

  test('proxies absolute URLs that contain known API markers', () => {
    // These should be remapped to use the backend URL
    const hassUrl = 'https://hass.example.com/api/image/serve/12345';
    expect(toBackendImageUrl(hassUrl)).toBe('http://backend.test/api/image/serve/12345');

    const agentUrl = 'http://192.168.1.10:8123/api/hass_agent/media/audio.mp3?token=abc';
    expect(toBackendImageUrl(agentUrl)).toBe('http://backend.test/api/hass_agent/media/audio.mp3?token=abc');
  });

  test('returns the original URL for absolute URLs without API markers', () => {
    const externalUrl = 'https://images.unsplash.com/photo-123456789';
    expect(toBackendImageUrl(externalUrl)).toBe(externalUrl);
  });

  test('handles protocol-relative URLs by prefixing the current protocol', () => {
    // Current protocol is mocked as 'http:' in setup.ts
    expect(toBackendImageUrl('//cdn.example.com/image.png')).toBe('http://cdn.example.com/image.png');
  });

  test('proxies absolute paths that contain known API markers', () => {
    expect(toBackendImageUrl('/api/image/serve/999')).toBe('http://backend.test/api/image/serve/999');
  });

  test('prefixes absolute paths without markers with the backend URL', () => {
    expect(toBackendImageUrl('/local/custom_icon.svg')).toBe('http://backend.test/local/custom_icon.svg');
  });

  test('prefixes relative paths with the backend URL', () => {
    expect(toBackendImageUrl('assets/logo.png')).toBe('http://backend.test/assets/logo.png');
  });

  test('returns the original string if URL parsing fails for an absolute-looking URL', () => {
    // If it starts with http:// but is not a valid URL, it should return it as-is
    const invalidUrl = 'http://[invalid-url]';
    expect(toBackendImageUrl(invalidUrl)).toBe(invalidUrl);
  });
});
