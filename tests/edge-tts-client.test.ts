import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EdgeTtsClient,
  EdgeTtsError,
  EdgeTtsErrorCode,
  DEFAULT_HOAI_MY_VOICE,
  DEFAULT_NAM_MINH_VOICE,
} from '../src/core/tts/index';
import type { WebSocketLike } from '../src/core/tts/index';
import type { VoiceProfile } from '../src/types/domain';

// ---------------------------------------------------------------------------
// Helpers — mock WebSocket factory
// ---------------------------------------------------------------------------

/** A controllable fake WebSocket handle returned by the factory. */
interface MockWsHandle {
  ws: MockWebSocket;
  /** Call to simulate the server sending a text message. */
  sendText: (msg: string) => void;
  /** Call to simulate the server sending a binary frame. */
  sendBinary: (data: ArrayBuffer) => void;
  /** Call to simulate the connection closing. */
  close: (code?: number, reason?: string) => void;
  /** Call to simulate the connection opening. */
  open: () => void;
  /** Call to simulate a connection error. */
  error: () => void;
}

class MockWebSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  readonly sentMessages: (string | ArrayBuffer | Blob)[] = [];
  private _closed = false;

  send(data: string | ArrayBuffer | Blob): void {
    if (this._closed) throw new Error('WebSocket is closed');
    this.sentMessages.push(data);
  }

  close(): void {
    this._closed = true;
  }
}

function makeMockWsFactory(): {
  factory: (url: string) => WebSocketLike;
  handles: MockWsHandle[];
} {
  const handles: MockWsHandle[] = [];

  const factory = (_url: string): WebSocketLike => {
    const ws = new MockWebSocket();
    const handle: MockWsHandle = {
      ws,
      open: () => ws.onopen?.(new Event('open')),
      sendText: (msg) =>
        ws.onmessage?.(new MessageEvent('message', { data: msg })),
      sendBinary: (data) =>
        ws.onmessage?.(new MessageEvent('message', { data })),
      close: (code = 1000, reason = '') =>
        ws.onclose?.(new CloseEvent('close', { code, reason, wasClean: code === 1000 })),
      error: () => ws.onerror?.(new Event('error')),
    };
    handles.push(handle);
    return ws;
  };

  return { factory, handles };
}

/**
 * Correctly waits until the condition is satisfied (throws if not ready).
 * vi.waitFor retries as long as the callback throws, so we throw when not ready.
 */
async function waitUntil(condition: () => boolean, timeout = 2000): Promise<void> {
  await vi.waitFor(() => {
    if (!condition()) throw new Error('condition not met');
  }, { timeout });
}

// ---------------------------------------------------------------------------
// Binary frame helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fake Edge TTS binary audio frame:
 * [2-byte big-endian header length][text header][binary audio payload]
 */
function buildAudioFrame(headerText: string, audioBytes: Uint8Array): ArrayBuffer {
  const enc = new TextEncoder();
  const headerBuf = enc.encode(headerText);
  const headerLen = headerBuf.byteLength;

  const frame = new ArrayBuffer(2 + headerLen + audioBytes.byteLength);
  const view = new DataView(frame);
  view.setUint16(0, headerLen, false); // big-endian

  const u8 = new Uint8Array(frame);
  u8.set(headerBuf, 2);
  u8.set(audioBytes, 2 + headerLen);

  return frame;
}

const FAKE_AUDIO_HEADER = 'X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n';
const FAKE_AUDIO_BYTES = new Uint8Array([0xff, 0xfb, 0x10, 0x00, 0xaa, 0xbb]);

const FEMALE_VOICE: VoiceProfile = {
  id: 'hoai-my',
  name: 'HoaiMy',
  gender: 'female',
  locale: 'vi-VN',
  provider: 'edge-tts',
  voiceKey: 'vi-VN-HoaiMyNeural',
  pitch: '+0Hz',
  rate: '+0%',
};

const MALE_VOICE: VoiceProfile = {
  id: 'nam-minh',
  name: 'NamMinh',
  gender: 'male',
  locale: 'vi-VN',
  provider: 'edge-tts',
  voiceKey: 'vi-VN-NamMinhNeural',
  pitch: '+5Hz',
  rate: '+10%',
};

// ---------------------------------------------------------------------------
// Predefined voice profiles
// ---------------------------------------------------------------------------

describe('predefined voice profiles', () => {
  it('DEFAULT_HOAI_MY_VOICE has correct voiceKey and locale', () => {
    expect(DEFAULT_HOAI_MY_VOICE.voiceKey).toBe('vi-VN-HoaiMyNeural');
    expect(DEFAULT_HOAI_MY_VOICE.locale).toBe('vi-VN');
    expect(DEFAULT_HOAI_MY_VOICE.gender).toBe('female');
    expect(DEFAULT_HOAI_MY_VOICE.provider).toBe('edge-tts');
  });

  it('DEFAULT_NAM_MINH_VOICE has correct voiceKey and locale', () => {
    expect(DEFAULT_NAM_MINH_VOICE.voiceKey).toBe('vi-VN-NamMinhNeural');
    expect(DEFAULT_NAM_MINH_VOICE.locale).toBe('vi-VN');
    expect(DEFAULT_NAM_MINH_VOICE.gender).toBe('male');
    expect(DEFAULT_NAM_MINH_VOICE.provider).toBe('edge-tts');
  });
});

// ---------------------------------------------------------------------------
// EdgeTtsClient — constructor
// ---------------------------------------------------------------------------

describe('EdgeTtsClient', () => {
  let mockFactory: ReturnType<typeof makeMockWsFactory>;

  beforeEach(() => {
    mockFactory = makeMockWsFactory();
  });

  describe('constructor', () => {
    it('constructs without options', () => {
      expect(() => new EdgeTtsClient()).not.toThrow();
    });

    it('constructs with webSocketFactory option', () => {
      expect(
        () => new EdgeTtsClient({ webSocketFactory: mockFactory.factory })
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // formatSsml
  // -------------------------------------------------------------------------

  describe('formatSsml', () => {
    it('returns a valid SSML string with speak, voice, and prosody elements', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('Hello world', FEMALE_VOICE);

      expect(ssml).toContain('<speak');
      expect(ssml).toContain('<voice name=');
      expect(ssml).toContain('<prosody');
      expect(ssml).toContain('</speak>');
    });

    it('embeds the correct voiceKey in the voice element', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('Test', FEMALE_VOICE);
      expect(ssml).toContain(`name='vi-VN-HoaiMyNeural'`);
    });

    it('embeds pitch and rate from VoiceProfile into prosody', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('Test', MALE_VOICE);
      expect(ssml).toContain(`pitch='+5Hz'`);
      expect(ssml).toContain(`rate='+10%'`);
    });

    it('defaults pitch to +0Hz and rate to +0% when not set on VoiceProfile', () => {
      const client = new EdgeTtsClient();
      const voiceWithoutProsody: VoiceProfile = { ...FEMALE_VOICE, pitch: undefined, rate: undefined };
      const ssml = client.formatSsml('Test', voiceWithoutProsody);
      expect(ssml).toContain(`pitch='+0Hz'`);
      expect(ssml).toContain(`rate='+0%'`);
    });

    it('sets xml:lang from voice locale', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('Test', FEMALE_VOICE);
      expect(ssml).toContain(`xml:lang='vi-VN'`);
    });

    it('includes the text content in the SSML', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('Xin chào thế giới', FEMALE_VOICE);
      expect(ssml).toContain('Xin chào thế giới');
    });

    it('escapes XML special characters in text', () => {
      const client = new EdgeTtsClient();
      const ssml = client.formatSsml('<Hello & "World">', FEMALE_VOICE);
      expect(ssml).not.toContain('<Hello');
      expect(ssml).toContain('&amp;');
      expect(ssml).toContain('&lt;');
    });
  });

  // -------------------------------------------------------------------------
  // synthesize — happy path
  // -------------------------------------------------------------------------

  describe('synthesize', () => {
    it('returns a Blob of type audio/mpeg when synthesis succeeds', async () => {
      const { factory, handles } = mockFactory;
      const client = new EdgeTtsClient({ webSocketFactory: factory });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      await waitUntil(() => handles.length > 0);
      handles[0].open();

      // Simulate receiving one audio frame then turn.end
      handles[0].sendBinary(buildAudioFrame(FAKE_AUDIO_HEADER, FAKE_AUDIO_BYTES));
      handles[0].sendText('Path:turn.end\r\n\r\n');

      const blob = await synthPromise;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/mpeg');
    });

    it('resolves with blob containing concatenated audio chunks from multiple frames', async () => {
      const { factory, handles } = mockFactory;
      const client = new EdgeTtsClient({ webSocketFactory: factory });

      const synthPromise = client.synthesize('Test', FEMALE_VOICE);
      await waitUntil(() => handles.length > 0);
      handles[0].open();

      const chunk1 = new Uint8Array([0xff, 0xfb, 0x01]);
      const chunk2 = new Uint8Array([0x02, 0x03, 0x04]);

      handles[0].sendBinary(buildAudioFrame(FAKE_AUDIO_HEADER, chunk1));
      handles[0].sendBinary(buildAudioFrame(FAKE_AUDIO_HEADER, chunk2));
      handles[0].sendText('Path:turn.end\r\n\r\n');

      const blob = await synthPromise;
      expect(blob.size).toBe(chunk1.byteLength + chunk2.byteLength);
    });

    it('sends an SSML synthesis message to the WebSocket', async () => {
      const { factory, handles } = mockFactory;
      const client = new EdgeTtsClient({ webSocketFactory: factory });

      const synthPromise = client.synthesize('Hello world', FEMALE_VOICE);
      await waitUntil(() => handles.length > 0);
      handles[0].open();
      handles[0].sendText('Path:turn.end\r\n\r\n');

      await synthPromise;

      const messages = handles[0].ws.sentMessages.map((m) => m.toString());
      const hasSsml = messages.some((m) => m.includes('<speak') && m.includes('vi-VN-HoaiMyNeural'));
      expect(hasSsml).toBe(true);
    });

    it('connects to the Edge TTS WebSocket URL', async () => {
      const capturedUrls: string[] = [];
      const capturingFactory = (url: string): WebSocketLike => {
        capturedUrls.push(url);
        return mockFactory.factory(url);
      };

      const client = new EdgeTtsClient({ webSocketFactory: capturingFactory });
      const synthPromise = client.synthesize('Hi', FEMALE_VOICE);
      await waitUntil(() => mockFactory.handles.length > 0);
      mockFactory.handles[0].open();
      mockFactory.handles[0].sendText('Path:turn.end\r\n\r\n');
      await synthPromise;

      expect(capturedUrls[0]).toContain('speech.platform.bing.com');
      expect(capturedUrls[0]).toContain('trustedclienttoken');
    });
  });

  // -------------------------------------------------------------------------
  // Binary frame parsing
  // -------------------------------------------------------------------------

  describe('binary frame parsing', () => {
    it('ignores binary frames whose header Path is not "audio"', async () => {
      const { factory, handles } = mockFactory;
      const client = new EdgeTtsClient({ webSocketFactory: factory });

      const synthPromise = client.synthesize('Test', FEMALE_VOICE);
      await waitUntil(() => handles.length > 0);
      handles[0].open();

      // Non-audio header — should not contribute to blob
      const nonAudioHeader = 'Path:metadata\r\nContent-Type:application/json\r\n';
      handles[0].sendBinary(buildAudioFrame(nonAudioHeader, new Uint8Array([0x01, 0x02])));

      // Real audio frame
      handles[0].sendBinary(buildAudioFrame(FAKE_AUDIO_HEADER, FAKE_AUDIO_BYTES));
      handles[0].sendText('Path:turn.end\r\n\r\n');

      const blob = await synthPromise;
      expect(blob.size).toBe(FAKE_AUDIO_BYTES.byteLength);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws EdgeTtsError with MAX_RETRIES_EXCEEDED when all retries fail with NETWORK_ERROR', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      // Fail all 3 attempts with error events
      for (let i = 0; i < 3; i++) {
        await waitUntil(() => handles.length >= i + 1);
        handles[i].open();
        handles[i].error();
      }

      await expect(synthPromise).rejects.toMatchObject({
        code: EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      });
    });

    it('throws EdgeTtsError with MAX_RETRIES_EXCEEDED when all retries fail with CONNECTION_CLOSED', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      // Fail all 3 attempts with clean close events
      for (let i = 0; i < 3; i++) {
        await waitUntil(() => handles.length >= i + 1);
        handles[i].open();
        handles[i].close(1001, 'Going away');
      }

      await expect(synthPromise).rejects.toMatchObject({
        code: EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      });
    });

    it('EdgeTtsError is an instance of Error', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      for (let i = 0; i < 3; i++) {
        await waitUntil(() => handles.length >= i + 1);
        handles[i].open();
        handles[i].error();
      }

      try {
        await synthPromise;
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(EdgeTtsError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Retry / reconnection logic
  // -------------------------------------------------------------------------

  describe('retry logic', () => {
    it('retries up to 3 times on connection error and resolves on eventual success', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      // Attempt 1 — error
      await waitUntil(() => handles.length >= 1);
      handles[0].open();
      handles[0].error();

      // Attempt 2 — error
      await waitUntil(() => handles.length >= 2);
      handles[1].open();
      handles[1].error();

      // Attempt 3 — success
      await waitUntil(() => handles.length >= 3);
      handles[2].open();
      handles[2].sendBinary(buildAudioFrame(FAKE_AUDIO_HEADER, FAKE_AUDIO_BYTES));
      handles[2].sendText('Path:turn.end\r\n\r\n');

      const blob = await synthPromise;
      expect(blob).toBeInstanceOf(Blob);
      expect(handles.length).toBe(3);
    });

    it('throws EdgeTtsError with MAX_RETRIES_EXCEEDED after exhausting all retries', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      // Fail all 3 attempts
      for (let i = 0; i < 3; i++) {
        await waitUntil(() => handles.length >= i + 1);
        handles[i].open();
        handles[i].error();
      }

      await expect(synthPromise).rejects.toMatchObject({
        code: EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      });
    });

    it('retries on premature close and throws MAX_RETRIES_EXCEEDED after all attempts fail', async () => {
      const { factory, handles } = makeMockWsFactory();
      const client = new EdgeTtsClient({ webSocketFactory: factory, retryDelayMs: 0 });

      const synthPromise = client.synthesize('Hello', FEMALE_VOICE);

      // All 3 attempts close before turn.end
      for (let i = 0; i < 3; i++) {
        await waitUntil(() => handles.length >= i + 1);
        handles[i].close(1001, 'Server down');
      }

      await expect(synthPromise).rejects.toMatchObject({
        code: EdgeTtsErrorCode.MAX_RETRIES_EXCEEDED,
      });
    });
  });
});
