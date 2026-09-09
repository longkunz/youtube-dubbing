import { describe, it, expect, vi } from 'vitest';
import { playAudioBlob, TTS_PREVIEW_TEXT, type PreviewAudio } from '../src/core/tts/tts-preview';

function makeFakeAudio(): PreviewAudio & {
  played: boolean;
  paused: boolean;
  finish: () => void;
  fail: () => void;
  playMock: ReturnType<typeof vi.fn>;
} {
  const playMock = vi.fn((): Promise<void> => {
    fake.played = true;
    return Promise.resolve();
  });
  const fake: PreviewAudio & {
    played: boolean;
    paused: boolean;
    finish: () => void;
    fail: () => void;
    playMock: ReturnType<typeof vi.fn>;
  } = {
    played: false,
    paused: false,
    onended: null,
    onerror: null,
    play: undefined as unknown as () => Promise<void>,
    pause: () => {
      fake.paused = true;
    },
    finish: () => fake.onended?.(),
    fail: () => fake.onerror?.(),
    playMock,
  };
  fake.play = playMock as unknown as () => Promise<void>;
  return fake;
}

describe('playAudioBlob (Edge-TTS voice preview)', () => {
  it('exposes the preview sample text in Vietnamese', () => {
    expect(TTS_PREVIEW_TEXT.length).toBeGreaterThan(0);
    expect(TTS_PREVIEW_TEXT).toMatch(/xin chào/i);
  });

  it('plays the blob audio and resolves when playback ends', async () => {
    const revoke = vi.fn();
    const fake = makeFakeAudio();
    const blob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' });

    const playback = playAudioBlob(blob, () => fake, revoke);
    expect(fake.played).toBe(true);

    fake.finish();
    await expect(playback.ended).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('rejects when the audio element errors', async () => {
    const fake = makeFakeAudio();
    const blob = new Blob(['x'], { type: 'audio/mpeg' });

    const playback = playAudioBlob(blob, () => fake, () => {});
    fake.fail();
    await expect(playback.ended).rejects.toThrow(/error during playback/i);
  });

  it('rejects when play() itself rejects (e.g. autoplay policy)', async () => {
    const fake = makeFakeAudio();
    fake.playMock.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    const blob = new Blob(['x'], { type: 'audio/mpeg' });

    const playback = playAudioBlob(blob, () => fake, () => {});
    await expect(playback.ended).rejects.toThrow(/NotAllowedError/);
  });

  it('stop() pauses audio, revokes the URL and settles `ended` so callers never hang', async () => {
    const revoke = vi.fn();
    const fake = makeFakeAudio();
    const blob = new Blob(['x'], { type: 'audio/mpeg' });

    const playback = playAudioBlob(blob, () => fake, revoke);
    playback.stop();

    expect(fake.paused).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    await expect(playback.ended).rejects.toThrow(/stopped by user/i);
  });
});
