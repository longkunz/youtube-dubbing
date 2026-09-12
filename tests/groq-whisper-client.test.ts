import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GroqWhisperClient,
  extractUnsignedAudioUrl,
  whisperSegmentsToDomain,
} from '../src/core/stt';
import type { FetchFn } from '../src/core/translation';

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('extractUnsignedAudioUrl', () => {
  it('returns a direct audio URL and ignores signatureCipher formats', () => {
    const url = extractUnsignedAudioUrl({
      streamingData: {
        adaptiveFormats: [
          {
            mimeType: 'audio/webm; codecs="opus"',
            signatureCipher: 's=ABC&url=https://googlevideo.com/ciphered',
          },
          {
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            url: 'https://googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    });
    expect(url).toBe('https://googlevideo.com/videoplayback?itag=140');
  });

  it('returns null when every audio format is ciphered or missing', () => {
    expect(
      extractUnsignedAudioUrl({
        streamingData: {
          adaptiveFormats: [
            { mimeType: 'audio/webm', signatureCipher: 's=ABC' },
            { mimeType: 'video/mp4', url: 'https://googlevideo.com/video-only' },
          ],
        },
      }),
    ).toBeNull();
    expect(extractUnsignedAudioUrl(null)).toBeNull();
  });
});

describe('whisperSegmentsToDomain', () => {
  it('maps verbose JSON segments onto the Segment contract', () => {
    const segments = whisperSegmentsToDomain([
      { start: 0.0, end: 1.8, text: ' Hello ' },
      { start: 1.8, end: 4.0, text: 'world' },
    ]);
    expect(segments).toEqual([
      {
        id: 'stt-0',
        startTime: 0,
        endTime: 1.8,
        duration: 1.8,
        sourceText: 'Hello',
      },
      {
        id: 'stt-1',
        startTime: 1.8,
        endTime: 4,
        duration: 2.2,
        sourceText: 'world',
      },
    ]);
  });
});

describe('GroqWhisperClient', () => {
  let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    mockFetch = vi.fn<FetchFn>();
  });

  it('posts the audio blob to Groq Whisper verbose_json and returns domain segments', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        text: 'Hello world',
        segments: [
          { start: 0, end: 1.2, text: 'Hello' },
          { start: 1.2, end: 2.4, text: 'world' },
        ],
      }),
    );

    const client = new GroqWhisperClient({ apiKey: ' gsk_test ', fetchFn: mockFetch });
    const result = await client.transcribeBlob(new Blob(['audio'], { type: 'audio/webm' }));

    expect(result).toHaveLength(2);
    expect(result[0].sourceText).toBe('Hello');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer gsk_test' });
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('throws when the Groq API key is missing', async () => {
    const client = new GroqWhisperClient({ apiKey: '   ', fetchFn: mockFetch });
    await expect(client.transcribeBlob(new Blob(['x']))).rejects.toThrow(/Groq API key/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces Groq HTTP error messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key' } }),
    });
    const client = new GroqWhisperClient({ apiKey: 'gsk_bad', fetchFn: mockFetch });
    await expect(client.transcribeBlob(new Blob(['x']))).rejects.toThrow(/Invalid API Key/);
  });
});
