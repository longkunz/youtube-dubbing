import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { OptionsDashboard } from '@/entrypoints/options/OptionsDashboard';
import {
  getSettings,
  saveSettings,
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
    expect(settings.ttsProvider).toBe('edge-tts');
    expect(settings.enableFallback).toBe(true);
  });

  it('persists and merges updated settings', async () => {
    await saveSettings({
      geminiApiKey: 'test-gemini-key-123',
      groqApiKey: 'test-groq-key-456',
    });

    const settings = await getSettings();
    expect(settings.geminiApiKey).toBe('test-gemini-key-123');
    expect(settings.groqApiKey).toBe('test-groq-key-456');
    expect(settings.ttsProvider).toBe('edge-tts'); // remains default
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
    expect(screen.getByText(/SUB-ATOMIC CACHE VAULT/i)).toBeInTheDocument();
  });

  it('toggles password visibility on API key inputs', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const geminiInput = screen.getByTestId('gemini-key-input') as HTMLInputElement;
    expect(geminiInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /toggle gemini api key visibility/i });
    fireEvent.click(toggleBtn);
    expect(geminiInput.type).toBe('text');

    fireEvent.click(toggleBtn);
    expect(geminiInput.type).toBe('password');
  });

  it('saves credentials and displays success status badge', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

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

    render(<OptionsDashboard segmentCache={segmentCache} pingFn={mockPing} />);

    const geminiInput = screen.getByTestId('gemini-key-input');
    fireEvent.change(geminiInput, { target: { value: 'AIzaSyTestGeminiKey' } });

    const pingBtn = screen.getByRole('button', { name: /ping connection/i });
    fireEvent.click(pingBtn);

    expect(mockPing).toHaveBeenCalledWith('AIzaSyTestGeminiKey');

    expect(await screen.findByText(/ONLINE \(110ms\)/i)).toBeInTheDocument();
  });

  it('displays error badge when ping test fails', async () => {
    const mockPing = vi.fn().mockResolvedValue({
      ok: false,
      latencyMs: 45,
      error: 'Invalid API Key',
    });

    render(<OptionsDashboard segmentCache={segmentCache} pingFn={mockPing} />);

    const geminiInput = screen.getByTestId('gemini-key-input');
    fireEvent.change(geminiInput, { target: { value: 'bad-key' } });

    const pingBtn = screen.getByRole('button', { name: /ping connection/i });
    fireEvent.click(pingBtn);

    expect(await screen.findByText(/ERROR: Invalid API Key/i)).toBeInTheDocument();
  });

  it('allows selecting TTS engine provider and calibrating pitch and rate', async () => {
    render(<OptionsDashboard segmentCache={segmentCache} />);

    const providerSelect = screen.getByRole('combobox', { name: /tts provider|select tts engine provider/i });
    expect(providerSelect).toHaveValue('edge-tts');

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

    // Switch to OpenAI-Compatible Proxy
    fireEvent.change(providerSelect, { target: { value: 'openai-compatible' } });
    expect(providerSelect).toHaveValue('openai-compatible');
    expect(screen.getByTestId('openai-endpoint-input')).toBeInTheDocument();
    expect(screen.getByTestId('openai-model-input')).toBeInTheDocument();
    expect(screen.getByTestId('openai-key-input')).toBeInTheDocument();
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

