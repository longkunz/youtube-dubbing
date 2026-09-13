import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { OptionsDashboard } from '@/entrypoints/options/OptionsDashboard';
import {
  getSettings,
  saveSettings,
  pingBackendConnection,
  DEFAULT_USER_SETTINGS,
  resetSettingsForTesting,
} from '@/storage/settings';
import { SegmentCache } from '@/storage/segment-cache';

describe('Settings Storage & Ping Connection (ADR-0013)', () => {
  beforeEach(async () => {
    await resetSettingsForTesting();
  });

  it('retrieves default settings when no stored preferences exist', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(settings.translationProvider).toBe('self-hosted');
    expect(settings.targetLanguage).toBe('vi');
    expect(settings.ttsProvider).toBe('zerotts');
    expect(settings.backendUrl).toBe('http://127.0.0.1:8787');
    expect(settings.backendApiKey).toBe('');
  });

  it('persists and merges updated settings', async () => {
    await saveSettings({
      backendApiKey: 'test-backend-key-123',
      backendUrl: 'http://192.168.1.50:8787',
    });

    const settings = await getSettings();
    expect(settings.backendApiKey).toBe('test-backend-key-123');
    expect(settings.backendUrl).toBe('http://192.168.1.50:8787');
    expect(settings.ttsProvider).toBe('zerotts');
  });

  it('migrates stored edge-tts provider to edge', async () => {
    await saveSettings({ ttsProvider: 'edge-tts' as any });
    const settings = await getSettings();
    expect(settings.ttsProvider).toBe('edge');
  });

  it('migrates stored backend tts provider to piper', async () => {
    await saveSettings({ ttsProvider: 'backend' as any });
    const settings = await getSettings();
    expect(settings.ttsProvider).toBe('piper');
  });

  it('pings health then one-cue translate', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, tts: 'zerotts', breaker: 'closed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'ping', text: 'ok' }] }),
      });
    const result = await pingBackendConnection('http://127.0.0.1:8787', 'k', fetchFn);
    expect(result.ok).toBe(true);
    expect(result.tts).toBe('zerotts');
    expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/health');
    expect(String(fetchFn.mock.calls[1][0])).toContain('/v1/translate');
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer k');
  });
});

describe('OptionsDashboard UI (AETHERDUB // COMMAND CENTER)', () => {
  let segmentCache: SegmentCache;

  beforeEach(async () => {
    await resetSettingsForTesting();
    segmentCache = new SegmentCache({ dbName: `test-options-cache-${Date.now()}` });
  });

  afterEach(() => {
    segmentCache.close();
  });

  it('renders the Command Center title and Sci-Fi dashboard sections', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    expect(screen.getByText(/AETHERDUB \/\/ COMMAND CENTER/i)).toBeInTheDocument();
    expect(screen.getByText(/NEURAL LINK CORE/i)).toBeInTheDocument();
    expect(screen.getByText(/TTS ENGINE FORGE/i)).toBeInTheDocument();
    expect(screen.getByText(/PARALLEL CAPTION OVERLAY/i)).toBeInTheDocument();
    expect(screen.getByText(/SUB-ATOMIC CACHE VAULT/i)).toBeInTheDocument();
  });

  it('toggles password visibility on Backend API key input', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const backendInput = (await screen.findByTestId('backend-key-input')) as HTMLInputElement;
    expect(backendInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /toggle backend api key visibility/i });
    fireEvent.click(toggleBtn);
    expect(backendInput.type).toBe('text');

    fireEvent.click(toggleBtn);
    expect(backendInput.type).toBe('password');
  });

  it('saves backend credentials and displays success status badge', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const urlInput = await screen.findByTestId('backend-url-input');
    const keyInput = screen.getByTestId('backend-key-input');
    const saveBtn = screen.getByRole('button', { name: /save credentials/i });

    fireEvent.change(urlInput, { target: { value: 'http://localhost:9000' } });
    fireEvent.change(keyInput, { target: { value: 'secret-token-123' } });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.backendUrl).toBe('http://localhost:9000');
      expect(saved.backendApiKey).toBe('secret-token-123');
    });

    expect(await screen.findByText(/credentials saved|settings saved/i)).toBeInTheDocument();
  });

  it('triggers backend ping test and displays latency status badge', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 70,
      tts: 'zerotts',
    });

    render(<OptionsDashboard segmentCache={segmentCache} pingBackendFn={mockPing} />);

    const pingBtn = screen.getByRole('button', { name: /ping connection|test connection/i });
    fireEvent.click(pingBtn);

    expect(mockPing).toHaveBeenCalled();
    expect(await screen.findByText(/ONLINE \(70ms\)/i)).toBeInTheDocument();
  });

  it('displays error badge when backend ping test fails', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Backend unreachable',
    });

    render(<OptionsDashboard segmentCache={segmentCache} pingBackendFn={mockPing} />);

    const pingBtn = screen.getByRole('button', { name: /ping connection|test connection/i });
    fireEvent.click(pingBtn);

    expect(await screen.findByText(/ERROR: Backend unreachable/i)).toBeInTheDocument();
  });

  it('resets the service-worker TTS breaker after a successful self-hosted ping', async () => {
    const resetTtsBreaker = vi.fn().mockResolvedValue(undefined);
    const pingBackendFn = vi.fn().mockResolvedValue({ ok: true, latencyMs: 42, tts: 'zerotts' });
    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        pingBackendFn={pingBackendFn}
        resetTtsBreaker={resetTtsBreaker}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ping connection|test connection/i }));
    await waitFor(() => {
      expect(pingBackendFn).toHaveBeenCalled();
      expect(resetTtsBreaker).toHaveBeenCalledTimes(1);
    });
  });

  it('allows selecting TTS engine provider (zerotts, piper, edge) and persists selection', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const providerSelect = screen.getByRole('combobox', { name: /tts provider|select tts engine provider/i });
    expect(providerSelect).toHaveValue('zerotts');

    fireEvent.change(providerSelect, { target: { value: 'edge' } });
    expect(providerSelect).toHaveValue('edge');

    await waitFor(async () => {
      expect((await getSettings()).ttsProvider).toBe('edge');
    });

    fireEvent.change(providerSelect, { target: { value: 'piper' } });
    expect(providerSelect).toHaveValue('piper');

    await waitFor(async () => {
      expect((await getSettings()).ttsProvider).toBe('piper');
    });
  });

  it('displays cache storage metrics and purges cache via purgeAll', async () => {
    const dummyBlob = new Blob(['sample audio payload'], { type: 'audio/mpeg' });
    await segmentCache.putAudioSegment({
      key: 'v1_vi_voice_s1',
      videoId: 'v1',
      language: 'vi',
      voiceId: 'voice',
      segmentId: 's1',
      audioBlob: dummyBlob,
      byteSize: dummyBlob.size,
    });

    render(<OptionsDashboard segmentCache={segmentCache} />);

    await waitFor(() => {
      expect(screen.getByText(/1 Video/i)).toBeInTheDocument();
    });

    const purgeBtn = screen.getByRole('button', { name: /purge local cache/i });
    fireEvent.click(purgeBtn);

    await waitFor(() => {
      expect(screen.getByText(/0 Videos/i)).toBeInTheDocument();
      expect(screen.getByText(/0\.00 MB/i)).toBeInTheDocument();
    });
  });
});

describe('ZeroTTS voice preview (TTS ENGINE FORGE)', () => {
  let segmentCache: SegmentCache;

  function makeFakeAudioHarness() {
    const instances: Array<{
      onended: null | (() => void);
      onerror: null | (() => void);
      finish: () => void;
      playCalls: number;
      pauseCalls: number;
    }> = [];
    const createPreviewAudio = () => {
      const inst = {
        onended: null as null | (() => void),
        onerror: null as null | (() => void),
        playCalls: 0,
        pauseCalls: 0,
        finish: () => inst.onended?.(),
      };
      instances.push(inst);
      return {
        play: () => {
          inst.playCalls += 1;
          return Promise.resolve();
        },
        pause: () => {
          inst.pauseCalls += 1;
        },
        get onended() {
          return inst.onended;
        },
        set onended(fn: null | (() => void)) {
          inst.onended = fn;
        },
        get onerror() {
          return inst.onerror;
        },
        set onerror(fn: null | (() => void)) {
          inst.onerror = fn;
        },
      };
    };
    return { instances, createPreviewAudio };
  }

  beforeEach(async () => {
    await resetSettingsForTesting();
    segmentCache = new SegmentCache({ dbName: `test-options-preview-${Date.now()}` });
  });

  afterEach(() => {
    segmentCache.close();
  });

  it('synthesizes via background client and shows PLAYBACK OK when audio ends', async () => {
    const audioBlob = new Blob(['fake-mp3'], { type: 'audio/mpeg' });
    const mockClient = {
      synthesize: vi.fn().mockResolvedValue(audioBlob),
    };
    const { instances, createPreviewAudio } = makeFakeAudioHarness();

    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        ttsPreviewClient={mockClient}
        createPreviewAudio={createPreviewAudio as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /preview zerotts voice|preview voice/i }));
    expect(await screen.findByText(/PLAYING/i)).toBeInTheDocument();
    expect(mockClient.synthesize).toHaveBeenCalledWith(
      expect.stringMatching(/xin chào/i),
      expect.objectContaining({ voice: 'maichi' })
    );

    instances[0].finish();
    expect(await screen.findByText(/PLAYBACK OK/i)).toBeInTheDocument();
  });

  it('shows ERROR badge when synthesis fails', async () => {
    const mockClient = {
      synthesize: vi.fn().mockRejectedValue(new Error('TTS synthesis timed out after 20s')),
    };
    const { createPreviewAudio } = makeFakeAudioHarness();

    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        ttsPreviewClient={mockClient}
        createPreviewAudio={createPreviewAudio as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /preview zerotts voice|preview voice/i }));
    expect(await screen.findByText(/ERROR: TTS synthesis timed out/i)).toBeInTheDocument();
  });

  it('stops playback when clicked while playing', async () => {
    const audioBlob = new Blob(['fake-mp3'], { type: 'audio/mpeg' });
    const mockClient = {
      synthesize: vi.fn().mockResolvedValue(audioBlob),
    };
    const { instances, createPreviewAudio } = makeFakeAudioHarness();

    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        ttsPreviewClient={mockClient}
        createPreviewAudio={createPreviewAudio as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /preview zerotts voice|preview voice/i }));
    expect(await screen.findByText(/PLAYING/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stop preview/i }));
    expect(instances[0].pauseCalls).toBe(1);
    expect(screen.queryByText(/PLAYBACK OK/i)).not.toBeInTheDocument();
  });

  it('stops active audio preview when unmounted', async () => {
    const audioBlob = new Blob(['fake-mp3'], { type: 'audio/mpeg' });
    const mockClient = {
      synthesize: vi.fn().mockResolvedValue(audioBlob),
    };
    const { instances, createPreviewAudio } = makeFakeAudioHarness();

    const { unmount } = render(
      <OptionsDashboard
        segmentCache={segmentCache}
        ttsPreviewClient={mockClient}
        createPreviewAudio={createPreviewAudio as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /preview zerotts voice|preview voice/i }));
    expect(await screen.findByText(/PLAYING/i)).toBeInTheDocument();

    unmount();
    expect(instances[0].pauseCalls).toBe(1);
  });
});

describe('OptionsDashboard — Parallel Caption Overlay Settings (Issue #18)', () => {
  let segmentCache: SegmentCache;

  beforeEach(async () => {
    segmentCache = new SegmentCache();
    await resetSettingsForTesting();
  });

  afterEach(() => {
    segmentCache.close();
  });

  it('allows configuring and persisting subtitle display mode, line order, and font size', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const displayModeSelect = await screen.findByTestId('subtitle-display-mode-select');
    const lineOrderSelect = await screen.findByTestId('subtitle-line-order-select');
    const fontSizeSelect = await screen.findByTestId('subtitle-font-size-select');

    expect(displayModeSelect).toHaveValue('bilingual');
    expect(lineOrderSelect).toHaveValue('original-first');
    expect(fontSizeSelect).toHaveValue('standard');

    fireEvent.change(displayModeSelect, { target: { value: 'translated-only' } });
    fireEvent.change(lineOrderSelect, { target: { value: 'translated-first' } });
    fireEvent.change(fontSizeSelect, { target: { value: 'large' } });

    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.subtitleDisplayMode).toBe('translated-only');
      expect(saved.subtitleLineOrder).toBe('translated-first');
      expect(saved.subtitleFontSize).toBe('large');
    });
  });
});
