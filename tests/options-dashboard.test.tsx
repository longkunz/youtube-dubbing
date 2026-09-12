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
  pingGeminiConnection,
  DEFAULT_USER_SETTINGS,
  resetSettingsForTesting,
} from '@/storage/settings';
import { SegmentCache } from '@/storage/segment-cache';

describe('Settings Storage & Ping Connection (Issue #8)', () => {
  beforeEach(async () => {
    await resetSettingsForTesting();
  });

  it('retrieves default settings when no stored preferences exist', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(settings.geminiApiKey).toBe('');
    expect(settings.groqApiKey).toBe('');
    expect(settings.ttsProvider).toBe('piper');
    expect(settings.enableFallback).toBe(true);
    expect(settings.geminiModel).toBe('gemini-3.8-flash');
  });

  it('persists and merges updated settings', async () => {
    await saveSettings({
      geminiApiKey: 'test-gemini-key-123',
      groqApiKey: 'test-groq-key-456',
    });

    const settings = await getSettings();
    expect(settings.geminiApiKey).toBe('test-gemini-key-123');
    expect(settings.groqApiKey).toBe('test-groq-key-456');
    expect(settings.ttsProvider).toBe('piper'); // remains default
    expect(settings.geminiModel).toBe('gemini-3.8-flash');
  });

  it('persists an explicit geminiModel selection', async () => {
    await saveSettings({ geminiModel: 'gemini-1.5-flash' });
    const settings = await getSettings();
    expect(settings.geminiModel).toBe('gemini-1.5-flash');
  });

  it('defaults new installs to self-hosted backend TTS', async () => {
    const settings = await getSettings();
    expect(settings.translationProvider).toBe('self-hosted');
    expect(settings.ttsProvider).toBe('piper');
    expect(settings.backendUrl).toBe('http://127.0.0.1:8787');
    expect(settings.backendApiKey).toBe('');
  });

  it('does not rewrite a stored gemini translation provider', async () => {
    await saveSettings({ translationProvider: 'gemini', geminiApiKey: 'abc' });
    const settings = await getSettings();
    expect(settings.translationProvider).toBe('gemini');
    expect(settings.geminiApiKey).toBe('abc');
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
        json: async () => ({ ok: true, tts: 'piper', breaker: 'closed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'ping', text: 'ok' }] }),
      });
    const result = await pingBackendConnection('http://127.0.0.1:8787', 'k', fetchFn);
    expect(result.ok).toBe(true);
    expect(result.tts).toBe('piper');
    expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/health');
    expect(String(fetchFn.mock.calls[1][0])).toContain('/v1/translate');
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer k');
  });

  describe('pingGeminiConnection', () => {
    it('returns error when API key is empty', async () => {
      const res = await pingGeminiConnection('');
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/API key is required/i);
    });

    it('returns ok: true with latency on successful HTTP 200 response', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        // simulate 50ms latency
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [] }),
        };
      });

      const res = await pingGeminiConnection('valid-api-key', mockFetch as unknown as typeof fetch);
      expect(res.ok).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(40);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.anything()
      );
    });

    it('returns ok: false with error details on HTTP error status', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({ error: { message: 'API key not valid' } }),
        };
      });

      const res = await pingGeminiConnection('invalid-key', mockFetch as unknown as typeof fetch);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/API key not valid/i);
    });

    it('pings the selected Gemini model endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const res = await pingGeminiConnection(
        'valid-api-key',
        mockFetch as unknown as typeof fetch,
        'gemini-3.8-flash',
      );
      expect(res.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-3.8-flash'),
        expect.anything(),
      );
      expect(mockFetch.mock.calls[0][0]).toContain('key=valid-api-key');
    });

    it('trims whitespace from the API key and model in the ping URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await pingGeminiConnection(
        '  valid-api-key  ',
        mockFetch as unknown as typeof fetch,
        '  gemini-2.5-flash  ',
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('gemini-2.5-flash');
      expect(calledUrl).toContain('key=valid-api-key');
      expect(calledUrl).not.toContain('%20');
    });
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

  /**
   * Render the dashboard pre-configured to Gemini and wait for the saved-settings
   * load to settle, so the async load cannot clobber later provider interactions.
   */
  async function renderGeminiDashboard(extraProps?: Partial<React.ComponentProps<typeof OptionsDashboard>>) {
    await saveSettings({ translationProvider: 'gemini' });
    render(<OptionsDashboard segmentCache={segmentCache} {...extraProps} />);
    await screen.findByTestId('gemini-key-input');
  }

  it('renders the Command Center title and Sci-Fi dashboard sections', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    expect(screen.getByText(/AETHERDUB \/\/ COMMAND CENTER/i)).toBeInTheDocument();
    expect(screen.getByText(/NEURAL LINK CORE/i)).toBeInTheDocument();
    expect(screen.getByText(/TTS ENGINE FORGE/i)).toBeInTheDocument();
    expect(screen.getByText(/SUB-ATOMIC CACHE VAULT/i)).toBeInTheDocument();
  });

  it('toggles password visibility on API key inputs', async () => {
    await renderGeminiDashboard();

    const geminiInput = screen.getByTestId('gemini-key-input') as HTMLInputElement;
    expect(geminiInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /toggle gemini api key visibility/i });
    fireEvent.click(toggleBtn);
    expect(geminiInput.type).toBe('text');

    fireEvent.click(toggleBtn);
    expect(geminiInput.type).toBe('password');
  });

  it('saves credentials and displays success status badge', async () => {
    await renderGeminiDashboard();

    const geminiInput = screen.getByTestId('gemini-key-input');
    const groqInput = screen.getByTestId('groq-key-input');
    const saveBtn = screen.getByRole('button', { name: /save credentials/i });

    fireEvent.change(geminiInput, { target: { value: 'AIzaSyTestGeminiKey' } });
    fireEvent.change(groqInput, { target: { value: 'gsk_testGroqKey' } });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.geminiApiKey).toBe('AIzaSyTestGeminiKey');
      expect(saved.groqApiKey).toBe('gsk_testGroqKey');
    });

    expect(await screen.findByText(/credentials saved|settings saved/i)).toBeInTheDocument();
  });

  it('triggers ping test and displays latency status badge', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 110,
    });

    await renderGeminiDashboard({ pingFn: mockPing });

    const geminiInput = screen.getByTestId('gemini-key-input');
    fireEvent.change(geminiInput, { target: { value: 'AIzaSyTestGeminiKey' } });

    const pingBtn = screen.getByRole('button', { name: /ping connection/i });
    fireEvent.click(pingBtn);

    expect(mockPing).toHaveBeenCalledWith('AIzaSyTestGeminiKey', 'gemini-3.8-flash');

    expect(await screen.findByText(/ONLINE \(110ms\)/i)).toBeInTheDocument();
  });

  it('displays error badge when ping test fails', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: false,
      latencyMs: 45,
      error: 'Invalid API Key',
    });

    await renderGeminiDashboard({ pingFn: mockPing });

    const geminiInput = screen.getByTestId('gemini-key-input');
    fireEvent.change(geminiInput, { target: { value: 'bad-key' } });

    const pingBtn = screen.getByRole('button', { name: /ping connection/i });
    fireEvent.click(pingBtn);

    expect(await screen.findByText(/ERROR: Invalid API Key/i)).toBeInTheDocument();
  });

  it('persists Edge Neural TTS as soon as the engine dropdown changes', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);
    const providerSelect = screen.getByRole('combobox', { name: /tts provider|select tts engine provider/i });
    fireEvent.change(providerSelect, { target: { value: 'edge' } });
    await waitFor(async () => {
      expect((await getSettings()).ttsProvider).toBe('edge');
    });
  });

  it('allows selecting TTS engine provider and calibrating pitch and rate', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const providerSelect = screen.getByRole('combobox', { name: /tts provider|select tts engine provider/i });
    expect(providerSelect).toHaveValue('piper');

    fireEvent.change(providerSelect, { target: { value: 'edge' } });
    expect(providerSelect).toHaveValue('edge');
    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));
    await waitFor(async () => {
      expect((await getSettings()).ttsProvider).toBe('edge');
    });

    fireEvent.change(providerSelect, { target: { value: 'web-speech' } });
    expect(providerSelect).toHaveValue('web-speech');

    const saveBtn = screen.getByRole('button', { name: /save credentials/i });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.ttsProvider).toBe('web-speech');
    });
  });

  it('displays cache storage metrics and purges cache via purgeAll', async () => {
    // Populate cache with dummy data
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

    // Wait for metrics to load
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

  it('switches between OpenAI-compatible proxy and Gemini translation providers', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    // Check translation provider selector exists
    const providerSelect = screen.getByRole('combobox', { name: /translation provider/i });
    expect(providerSelect).toBeInTheDocument();

    // Switch to Gemini
    fireEvent.change(providerSelect, { target: { value: 'gemini' } });
    expect(providerSelect).toHaveValue('gemini');
    expect(screen.getByTestId('gemini-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('gemini-model-select')).toBeInTheDocument();

    // Switch to OpenAI-Compatible Proxy
    fireEvent.change(providerSelect, { target: { value: 'openai-compatible' } });
    expect(providerSelect).toHaveValue('openai-compatible');
    expect(screen.getByTestId('openai-endpoint-input')).toBeInTheDocument();
    expect(screen.getByTestId('openai-model-input')).toBeInTheDocument();
    expect(screen.getByTestId('openai-key-input')).toBeInTheDocument();
    expect(screen.queryByTestId('gemini-model-select')).not.toBeInTheDocument();
  });

  it('renders Gemini model presets and defaults to gemini-3.8-flash', async () => {
    await renderGeminiDashboard();

    const modelSelect = await screen.findByTestId('gemini-model-select');
    expect(modelSelect).toHaveValue('gemini-3.8-flash');
    expect(screen.getByRole('option', { name: 'gemini-3.8-flash' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gemini-3.5-flash' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gemini-3.5-flash-lite' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gemini-2.5-flash' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'custom' })).toBeInTheDocument();
    expect(screen.queryByTestId('gemini-model-custom-input')).not.toBeInTheDocument();
  });

  it('reveals a custom model input when custom is selected', async () => {
    await renderGeminiDashboard();

    const modelSelect = await screen.findByTestId('gemini-model-select');
    fireEvent.change(modelSelect, { target: { value: 'custom' } });

    expect(screen.getByTestId('gemini-model-custom-input')).toBeInTheDocument();
    expect(screen.getByTestId('gemini-model-custom-input')).toHaveValue('gemini-3.8-flash');
  });

  it('persists a preset Gemini model on save', async () => {
    await renderGeminiDashboard();

    const modelSelect = await screen.findByTestId('gemini-model-select');
    fireEvent.change(modelSelect, { target: { value: 'gemini-3.5-flash' } });
    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.geminiModel).toBe('gemini-3.5-flash');
    });
  });

  it('persists a custom Gemini model identifier on save', async () => {
    await renderGeminiDashboard();

    const modelSelect = await screen.findByTestId('gemini-model-select');
    fireEvent.change(modelSelect, { target: { value: 'custom' } });
    fireEvent.change(screen.getByTestId('gemini-model-custom-input'), {
      target: { value: 'gemini-exp-1206' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.geminiModel).toBe('gemini-exp-1206');
    });
  });

  it('loads a non-preset saved model as the custom option', async () => {
    await saveSettings({ geminiModel: 'gemini-exp-1206', translationProvider: 'gemini' });
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const modelSelect = await screen.findByTestId('gemini-model-select');
    await waitFor(() => {
      expect(modelSelect).toHaveValue('custom');
    });
    expect(screen.getByTestId('gemini-model-custom-input')).toHaveValue('gemini-exp-1206');
  });

  it('pings using the selected Gemini model', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 42,
    });

    await renderGeminiDashboard({ pingFn: mockPing });

    const modelSelect = await screen.findByTestId('gemini-model-select');
    fireEvent.change(modelSelect, { target: { value: 'gemini-3.8-flash' } });
    fireEvent.change(screen.getByTestId('gemini-key-input'), {
      target: { value: 'AIzaSyTestGeminiKey' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ping connection/i }));

    expect(mockPing).toHaveBeenCalledWith('AIzaSyTestGeminiKey', 'gemini-3.8-flash');
    expect(await screen.findByText(/ONLINE \(42ms\)/i)).toBeInTheDocument();
  });

  it('persists YouTube Caption Translation without requiring a Gemini key or Ping', async () => {
    await saveSettings({ geminiApiKey: 'AIzaSyKeepMe', translationProvider: 'gemini' });
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const keyInput = await screen.findByTestId('gemini-key-input');
    await waitFor(() => {
      expect(keyInput).toHaveValue('AIzaSyKeepMe');
    });

    fireEvent.change(screen.getByRole('combobox', { name: /translation provider/i }), {
      target: { value: 'youtube-caption-translation' },
    });

    expect(screen.queryByTestId('gemini-key-input')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ping connection|test connection/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.translationProvider).toBe('youtube-caption-translation');
      expect(saved.geminiApiKey).toBe('AIzaSyKeepMe');
    });
  });

  it('resets the service-worker TTS breaker after a successful self-hosted ping', async () => {
    const resetTtsBreaker = vi.fn().mockResolvedValue(undefined);
    const pingBackendFn = vi.fn().mockResolvedValue({ ok: true, latencyMs: 42, tts: 'piper' });
    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        pingBackendFn={pingBackendFn}
        resetTtsBreaker={resetTtsBreaker}
      />,
    );
    await waitFor(() => screen.getByLabelText('Translation Provider'));
    fireEvent.click(screen.getByRole('button', { name: /ping connection|test connection/i }));
    await waitFor(() => {
      expect(pingBackendFn).toHaveBeenCalled();
      expect(resetTtsBreaker).toHaveBeenCalledTimes(1);
    });
  });

  it('saves self-hosted backend url and key and does not require gemini', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);
    await waitFor(() => screen.getByLabelText('Translation Provider'));
    fireEvent.change(screen.getByLabelText('Translation Provider'), {
      target: { value: 'self-hosted' },
    });
    fireEvent.change(screen.getByLabelText('Backend URL'), {
      target: { value: 'http://192.168.1.10:8787' },
    });
    fireEvent.change(screen.getByLabelText('Backend API Key'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.translationProvider).toBe('self-hosted');
      expect(saved.backendUrl).toBe('http://192.168.1.10:8787');
      expect(saved.backendApiKey).toBe('secret');
    });
  });

  it('saves OpenAI proxy settings to storage', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const providerSelect = screen.getByRole('combobox', { name: /translation provider/i });
    fireEvent.change(providerSelect, { target: { value: 'openai-compatible' } });

    const endpointInput = screen.getByTestId('openai-endpoint-input');
    const modelInput = screen.getByTestId('openai-model-input');
    const apiKeyInput = screen.getByTestId('openai-key-input');
    const saveBtn = screen.getByRole('button', { name: /save credentials/i });

    fireEvent.change(endpointInput, { target: { value: 'https://my-proxy.internal/v1' } });
    fireEvent.change(modelInput, { target: { value: 'claude-3-haiku' } });
    fireEvent.change(apiKeyInput, { target: { value: 'sk-custom-123' } });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.translationProvider).toBe('openai-compatible');
      expect(saved.openaiEndpoint).toBe('https://my-proxy.internal/v1');
      expect(saved.openaiModel).toBe('claude-3-haiku');
      expect(saved.openaiApiKey).toBe('sk-custom-123');
    });
  });

  it('triggers OpenAI connection test and displays latency status', async () => {
    const mockPingOpenAi = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 88,
    });

    render(
      <OptionsDashboard
        segmentCache={segmentCache}
        pingOpenAiFn={mockPingOpenAi}
      />
    );

    const providerSelect = screen.getByRole('combobox', { name: /translation provider/i });
    fireEvent.change(providerSelect, { target: { value: 'openai-compatible' } });

    const pingBtn = screen.getByRole('button', { name: /test connection|ping connection/i });
    fireEvent.click(pingBtn);

    expect(mockPingOpenAi).toHaveBeenCalled();
    expect(await screen.findByText(/ONLINE \(88ms\)/i)).toBeInTheDocument();
  });
});

describe('Edge-TTS voice preview (TTS ENGINE FORGE)', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /preview edge tts voice/i }));
    expect(await screen.findByText(/PLAYING/i)).toBeInTheDocument();
    expect(mockClient.synthesize).toHaveBeenCalledWith(
      expect.stringMatching(/xin chào/i),
      expect.objectContaining({ voice: 'vi-VN-HoaiMyNeural' })
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

    fireEvent.click(screen.getByRole('button', { name: /preview edge tts voice/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /preview edge tts voice/i }));
    expect(await screen.findByText(/PLAYING/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stop preview/i }));
    expect(instances[0].pauseCalls).toBe(1);
    expect(screen.queryByText(/PLAYBACK OK/i)).not.toBeInTheDocument();
  });
});

