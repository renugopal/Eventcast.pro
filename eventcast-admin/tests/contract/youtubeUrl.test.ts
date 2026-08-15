import { describe, expect, it } from 'vitest';
import { isValidYoutubeWatchUrl } from '@/lib/youtubeUrl';

describe('isValidYoutubeWatchUrl', () => {
  it('accepts youtube.com, www.youtube.com, and youtu.be watch links', () => {
    expect(isValidYoutubeWatchUrl('https://youtube.com/watch?v=abc')).toBe(true);
    expect(isValidYoutubeWatchUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isValidYoutubeWatchUrl('https://youtu.be/abc123')).toBe(true);
    expect(isValidYoutubeWatchUrl('http://youtube.com/watch?v=abc')).toBe(true);
  });

  it('rejects non-YouTube hosts, including lookalikes', () => {
    expect(isValidYoutubeWatchUrl('https://evil.example.com/live')).toBe(false);
    expect(isValidYoutubeWatchUrl('https://notyoutube.com/watch?v=abc')).toBe(false);
    expect(isValidYoutubeWatchUrl('https://youtube.com.evil.example/watch')).toBe(false);
  });

  it('rejects malformed URLs and non-http(s) protocols', () => {
    expect(isValidYoutubeWatchUrl('not a url')).toBe(false);
    expect(isValidYoutubeWatchUrl('javascript:alert(1)')).toBe(false);
    expect(isValidYoutubeWatchUrl('ftp://youtube.com/watch?v=abc')).toBe(false);
  });
});
