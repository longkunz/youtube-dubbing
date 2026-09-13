import React, { useState, useEffect, useRef } from 'react';
import {
  getSettings,
  saveSettings,
  pingBackendConnection,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type PingBackendResult,
  type TranslationProvider,
  type TtsProvider,
  type SubtitleDisplayMode,
  type SubtitleLineOrder,
  type SubtitleFontSize,
} from '../../storage/settings';
import { sendExtensionMessage } from '../../core/extension-runtime';
import { SegmentCache, type StorageUsageStats } from '../../storage/segment-cache';
import { BackgroundDubbingTtsClient } from '../../core/tts/background-tts-client';
import {
  playAudioBlob,
  TTS_PREVIEW_TEXT,
  type PreviewAudio,
  type PreviewPlayback,
} from '../../core/tts/tts-preview';
import {
  Key,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Activity,
  Save,
  Trash2,
  CheckCircle2,
  Sliders,
  Radio,
  RotateCcw,
} from 'lucide-react';
import { getActiveSubtitleInstance } from '../content/subtitle-mount';

async function defaultResetTtsBreaker(): Promise<void> {
  await sendExtensionMessage({ action: 'RESET_TTS_BREAKER' }, 5_000);
}

export interface OptionsDashboardProps {
  segmentCache?: SegmentCache;
  pingBackendFn?: (
    url: string,
    apiKey: string
  ) => Promise<PingBackendResult>;
  /** After a successful Self-hosted Ping, reset the worker TTS circuit breaker. */
  resetTtsBreaker?: () => Promise<void>;
  /** Injectable client for the voice preview (defaults to background proxy). */
  ttsPreviewClient?: {
    synthesize(
      text: string,
      options?: { voice?: string; rate?: string; pitch?: string }
    ): Promise<Blob>;
  };
  /** Injectable audio factory for the voice preview (defaults to `new Audio(url)`). */
  createPreviewAudio?: (url: string) => PreviewAudio;
}

export type TtsPreviewPhase = 'idle' | 'synthesizing' | 'playing' | 'success' | 'error';

export const OptionsDashboard: React.FC<OptionsDashboardProps> = ({
  segmentCache,
  pingBackendFn,
  resetTtsBreaker,
  ttsPreviewClient,
  createPreviewAudio,
}) => {
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8787');
  const [backendApiKey, setBackendApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>('zerotts');
  const [ttsPitch, setTtsPitch] = useState('+0Hz');
  const [ttsRate, setTtsRate] = useState('+0%');
  const [subtitleDisplayMode, setSubtitleDisplayMode] = useState<SubtitleDisplayMode>('bilingual');
  const [subtitleLineOrder, setSubtitleLineOrder] = useState<SubtitleLineOrder>('original-first');
  const [subtitleFontSize, setSubtitleFontSize] = useState<SubtitleFontSize>('standard');
  const [resetPositionStatus, setResetPositionStatus] = useState<string | null>(null);

  const [showBackendKey, setShowBackendKey] = useState(false);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<{
    loading: boolean;
    result?: { ok: boolean; latencyMs?: number; error?: string };
  } | null>(null);

  const [storageUsage, setStorageUsage] = useState<StorageUsageStats | null>(null);
  const [isPurging, setIsPurging] = useState(false);

  const [ttsPreview, setTtsPreview] = useState<{
    phase: TtsPreviewPhase;
    detail?: string;
  }>({ phase: 'idle' });
  const previewPlaybackRef = useRef<PreviewPlayback | null>(null);
  const previewRunIdRef = useRef(0);

  // Ensure any active audio preview is stopped when unmounted
  useEffect(() => {
    return () => {
      previewPlaybackRef.current?.stop();
      previewPlaybackRef.current = null;
    };
  }, []);

  const cache = segmentCache ?? new SegmentCache();

  useEffect(() => {
    let active = true;

    getSettings().then((saved) => {
      if (!active) return;
      setBackendUrl(saved.backendUrl || 'http://127.0.0.1:8787');
      setBackendApiKey(saved.backendApiKey || '');
      setTtsProvider(saved.ttsProvider || 'zerotts');
      setTtsPitch(saved.ttsPitch || '+0Hz');
      setTtsRate(saved.ttsRate || '+0%');
      setSubtitleDisplayMode(saved.subtitleDisplayMode || 'bilingual');
      setSubtitleLineOrder(saved.subtitleLineOrder || 'original-first');
      setSubtitleFontSize(saved.subtitleFontSize || 'standard');
    });

    const loadMetrics = async () => {
      try {
        const usage = await cache.getStorageUsage();
        if (active) {
          setStorageUsage(usage);
        }
      } catch {
        // Safe catch
      }
    };

    loadMetrics();

    return () => {
      active = false;
      if (!segmentCache) {
        cache.close();
      }
    };
  }, [segmentCache]);

  const handleResetSubtitlePosition = async () => {
    await saveSettings({ subtitlePosition: null });
    const activeInst = getActiveSubtitleInstance();
    if (activeInst) {
      activeInst.resetPosition();
    }
    setResetPositionStatus('Position reset');
    setTimeout(() => {
      setResetPositionStatus(null);
    }, 2500);
  };

  const handleSaveCredentials = async () => {
    await saveSettings({
      translationProvider: 'self-hosted',
      targetLanguage: 'vi',
      backendUrl,
      backendApiKey: backendApiKey.trim(),
      ttsProvider,
      ttsPitch,
      ttsRate,
      subtitleDisplayMode,
      subtitleLineOrder,
      subtitleFontSize,
    });
    setSaveStatus('Credentials saved');
    setTimeout(() => {
      setSaveStatus(null);
    }, 3000);
  };

  const handlePing = async () => {
    setPingStatus({ loading: true });
    try {
      const pingImpl = pingBackendFn ?? pingBackendConnection;
      const result = await pingImpl(backendUrl, backendApiKey.trim());
      setPingStatus({
        loading: false,
        result: {
          ok: result.ok,
          latencyMs: result.latencyMs,
          error: result.error,
        },
      });

      if (result.ok) {
        const resetBreaker = resetTtsBreaker ?? defaultResetTtsBreaker;
        resetBreaker().catch((err) => {
          console.warn('[AetherDub] Failed to reset worker TTS breaker:', err);
        });
      }
    } catch (err) {
      setPingStatus({
        loading: false,
        result: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const handlePurgeCache = async () => {
    if (isPurging) return;
    setIsPurging(true);
    try {
      await cache.purge();
      const updated = await cache.getStorageUsage();
      setStorageUsage(updated);
    } catch (err) {
      console.error('[AetherDub] Purge cache failed:', err);
    } finally {
      setIsPurging(false);
    }
  };

  const handlePreviewVoice = async () => {
    if (previewPlaybackRef.current) {
      previewPlaybackRef.current.stop();
      previewPlaybackRef.current = null;
      setTtsPreview({ phase: 'idle' });
      return;
    }

    const runId = ++previewRunIdRef.current;
    setTtsPreview({ phase: 'synthesizing' });

    try {
      const client = ttsPreviewClient ?? new BackgroundDubbingTtsClient();
      const blob = await client.synthesize(TTS_PREVIEW_TEXT, {
        voice: 'maichi',
        pitch: ttsPitch,
        rate: ttsRate,
      });

      if (previewRunIdRef.current !== runId) return;

      const playback = playAudioBlob(
        blob,
        createPreviewAudio ?? ((url: string) => new Audio(url) as unknown as PreviewAudio)
      );
      previewPlaybackRef.current = playback;
      setTtsPreview({ phase: 'playing' });
      await playback.ended;
      if (previewRunIdRef.current !== runId) return;
      previewPlaybackRef.current = null;
      setTtsPreview({ phase: 'success', detail: `${(blob.size / 1024).toFixed(1)} KB played` });
    } catch (err) {
      if (previewRunIdRef.current !== runId) return;
      const message = err instanceof Error ? err.message : String(err);
      if (/stopped by user/i.test(message)) return;
      previewPlaybackRef.current = null;
      setTtsPreview({ phase: 'error', detail: message });
    }
  };

  const videoCount = storageUsage?.videoCount ?? 0;
  const totalBytes = storageUsage?.totalBytes ?? 0;
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  const videoCountLabel = videoCount === 1 ? '1 Video' : `${videoCount} Videos`;

  return (
    <div className="min-h-screen bg-[#05070e] text-white font-sans p-6 md:p-10 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-8">
        {/* Header Title */}
        <header className="border-b border-[#00f2fe]/30 pb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#00f2fe] shadow-[0_0_12px_#00f2fe] animate-pulse" />
              <h1 className="text-2xl md:text-3xl font-mono font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#00f2fe] via-[#ff007a] to-[#7928ca]">
                AETHERDUB // COMMAND CENTER
              </h1>
            </div>
            <p className="text-xs font-mono text-gray-400 mt-1 uppercase tracking-widest">
              Operations Deck // Strict Self-Hosted Backend Subsystems
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-mono rounded border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88]">
              SYS: READY
            </span>
          </div>
        </header>

        {/* Global Save Status Alert */}
        {saveStatus && (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-3 rounded-lg border border-[#00ff88]/50 bg-[#00ff88]/15 text-[#00ff88] font-mono text-sm shadow-[0_0_15px_rgba(0,255,136,0.2)] animate-in fade-in duration-200"
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{saveStatus}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8">
          {/* Section 1: Neural Link Core */}
          <section className="relative rounded-xl border border-[#00f2fe]/30 bg-[#0a0e1a]/85 backdrop-blur-xl p-6 shadow-[0_0_24px_rgba(0,242,254,0.1)]">
            <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-3 mb-6">
              <div className="flex items-center gap-2.5">
                <Key className="w-5 h-5 text-[#00f2fe]" />
                <h2 className="text-lg font-mono font-bold tracking-wide text-white">
                  NEURAL LINK CORE
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00f2fe]/10 text-[#00f2fe] border border-[#00f2fe]/30">
                BACKEND CONNECTION
              </span>
            </div>

            <div className="space-y-5">
              {/* Translation Provider Info */}
              <div>
                <label className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2">
                  Translation Engine
                </label>
                <div className="w-full bg-[#05070e] border border-[#00f2fe]/40 rounded-lg px-3.5 py-2.5 text-sm font-mono text-[#00f2fe]">
                  Self-hosted Backend (MarianMT EN→VI)
                </div>
              </div>

              {/* Self-hosted Backend URL */}
              <div>
                <label
                  htmlFor="backend-url"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Backend URL
                </label>
                <input
                  id="backend-url"
                  aria-label="Backend URL"
                  data-testid="backend-url-input"
                  type="text"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8787"
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all"
                />
              </div>

              {/* Self-hosted Backend API Key */}
              <div>
                <label
                  htmlFor="backend-key"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Backend API Key
                </label>
                <div className="relative flex items-center">
                  <input
                    id="backend-key"
                    aria-label="Backend API Key"
                    data-testid="backend-key-input"
                    type={showBackendKey ? 'text' : 'password'}
                    value={backendApiKey}
                    onChange={(e) => setBackendApiKey(e.target.value)}
                    placeholder="BACKEND_API_KEY from the Docker host .env"
                    className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all pr-10"
                  />
                  <button
                    type="button"
                    aria-label="Toggle Backend API Key visibility"
                    onClick={() => setShowBackendKey((prev) => !prev)}
                    className="absolute right-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer p-1"
                  >
                    {showBackendKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <p className="text-xs font-mono text-gray-400 leading-relaxed">
                Dedicated Self-hosted Backend for EN→VI MarianMT translation and real-time ZeroTTS synthesis (~70ms TTFA).
                No external cloud API keys or fallbacks required.
              </p>

              {/* Action Buttons & Ping Badge */}
              <div className="pt-3 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveCredentials}
                    data-testid="save-credentials-btn"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#00f2fe]/80 to-[#7928ca]/80 hover:from-[#00f2fe] hover:to-[#7928ca] text-white font-mono text-xs font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Credentials
                  </button>

                  <button
                    type="button"
                    aria-label="Ping Connection (Test Connection)"
                    data-testid="test-connection-btn"
                    onClick={handlePing}
                    disabled={pingStatus?.loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#00f2fe]/40 hover:border-[#00f2fe] bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 text-[#00f2fe] font-mono text-xs uppercase tracking-wider transition-all duration-150 cursor-pointer disabled:opacity-50"
                  >
                    <Activity className={`w-3.5 h-3.5 ${pingStatus?.loading ? 'animate-spin' : ''}`} />
                    Test Connection
                  </button>
                </div>

                {/* Ping Result Badge */}
                {pingStatus?.result && (
                  <div className="flex items-center">
                    {pingStatus.result.ok ? (
                      <span className="px-3 py-1 rounded border border-[#00ff88]/60 bg-[#00ff88]/15 text-[#00ff88] font-mono text-xs font-bold shadow-[0_0_10px_rgba(0,255,136,0.3)] animate-in fade-in">
                        ONLINE ({pingStatus.result.latencyMs}ms)
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded border border-[#ff007a]/60 bg-[#ff007a]/15 text-[#ff007a] font-mono text-xs font-bold shadow-[0_0_10px_rgba(255,0,122,0.3)] animate-in fade-in">
                        ERROR: {pingStatus.result.error || 'Connection Failed'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 2: TTS Engine Forge */}
          <section className="relative rounded-xl border border-[#7928ca]/40 bg-[#0a0e1a]/85 backdrop-blur-xl p-6 shadow-[0_0_24px_rgba(121,40,202,0.1)]">
            <div className="flex items-center justify-between border-b border-[#7928ca]/30 pb-3 mb-6">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-5 h-5 text-[#ff007a]" />
                <h2 className="text-lg font-mono font-bold tracking-wide text-white">
                  TTS ENGINE FORGE
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#ff007a]/10 text-[#ff007a] border border-[#ff007a]/30">
                VOICE SYNTHESIS
              </span>
            </div>

            <div className="space-y-5">
              <div>
                <label
                  htmlFor="tts-provider-select"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Select TTS Engine Provider
                </label>
                <select
                  id="tts-provider-select"
                  data-testid="tts-provider-select"
                  aria-label="Select TTS Engine Provider"
                  value={ttsProvider}
                  onChange={(e) => {
                    const next = e.target.value as TtsProvider;
                    setTtsProvider(next);
                    void saveSettings({ ttsProvider: next });
                  }}
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#ff007a] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#ff007a] transition-all"
                >
                  <option value="zerotts">ZeroTTS CPU (Real-Time ~70ms TTFA)</option>
                  <option value="piper">Piper Neural (Backend Local)</option>
                  <option value="edge">Edge Neural TTS (Backend Host)</option>
                </select>
              </div>

              {/* Pitch and Rate Calibration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label
                    htmlFor="pitch-input"
                    className="block text-xs font-mono text-gray-400 mb-1"
                  >
                    Pitch Modulation ({ttsPitch})
                  </label>
                  <input
                    id="pitch-input"
                    data-testid="pitch-input"
                    type="text"
                    value={ttsPitch}
                    onChange={(e) => setTtsPitch(e.target.value)}
                    placeholder="+0Hz"
                    className="w-full bg-[#05070e] border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#ff007a] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="rate-input"
                    className="block text-xs font-mono text-gray-400 mb-1"
                  >
                    Rate Modulation ({ttsRate})
                  </label>
                  <input
                    id="rate-input"
                    data-testid="rate-input"
                    type="text"
                    value={ttsRate}
                    onChange={(e) => setTtsRate(e.target.value)}
                    placeholder="+0%"
                    className="w-full bg-[#05070e] border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#ff007a] focus:outline-none"
                  />
                </div>
              </div>

              {/* ZeroTTS Voice Preview */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-gray-800">
                <p className="text-xs font-sans text-gray-400 max-w-md">
                  Synthesizes a short Vietnamese sample through ZeroTTS and plays it back.
                </p>
                <div className="flex items-center gap-3">
                  {ttsPreview.phase === 'success' && (
                    <span className="px-3 py-1 rounded border border-[#00ff88]/60 bg-[#00ff88]/15 text-[#00ff88] font-mono text-xs font-bold shadow-[0_0_10px_rgba(0,255,136,0.3)] animate-in fade-in">
                      PLAYBACK OK{ttsPreview.detail ? ` (${ttsPreview.detail})` : ''}
                    </span>
                  )}
                  {ttsPreview.phase === 'error' && (
                    <span className="px-3 py-1 rounded border border-[#ff007a]/60 bg-[#ff007a]/15 text-[#ff007a] font-mono text-xs font-bold shadow-[0_0_10px_rgba(255,0,122,0.3)] animate-in fade-in">
                      ERROR: {ttsPreview.detail || 'Preview failed'}
                    </span>
                  )}
                  {(ttsPreview.phase === 'synthesizing' || ttsPreview.phase === 'playing') && (
                    <span className="px-3 py-1 rounded border border-[#00f2fe]/60 bg-[#00f2fe]/15 text-[#00f2fe] font-mono text-xs font-bold animate-pulse">
                      {ttsPreview.phase === 'synthesizing' ? 'SYNTHESIZING…' : 'PLAYING… TAP TO STOP'}
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid="tts-preview-btn"
                    aria-label={
                      ttsPreview.phase === 'playing' || ttsPreview.phase === 'synthesizing'
                        ? 'Stop preview'
                        : 'Preview ZeroTTS voice'
                    }
                    onClick={handlePreviewVoice}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#ff007a]/40 hover:border-[#ff007a] bg-[#ff007a]/10 hover:bg-[#ff007a]/20 text-[#ff007a] font-mono text-xs uppercase tracking-wider transition-all duration-150 cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {ttsPreview.phase === 'playing' || ttsPreview.phase === 'synthesizing'
                      ? 'Stop Preview'
                      : 'Preview Voice'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Parallel Caption Overlay */}
          <section className="relative rounded-xl border border-[#00f2fe]/30 bg-[#0a0e1a]/85 backdrop-blur-xl p-6 shadow-[0_0_24px_rgba(0,242,254,0.08)]">
            <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-3 mb-6">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-[#00f2fe]" />
                <h2 className="text-lg font-mono font-bold tracking-wide text-white">
                  PARALLEL CAPTION OVERLAY
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00f2fe]/10 text-[#00f2fe] border border-[#00f2fe]/30">
                DUAL SUBTITLES
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label
                  htmlFor="subtitle-display-mode"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Display Mode
                </label>
                <select
                  id="subtitle-display-mode"
                  data-testid="subtitle-display-mode-select"
                  aria-label="Subtitle Display Mode"
                  value={subtitleDisplayMode}
                  onChange={(e) => {
                    const next = e.target.value as SubtitleDisplayMode;
                    setSubtitleDisplayMode(next);
                    void saveSettings({ subtitleDisplayMode: next });
                  }}
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all"
                >
                  <option value="bilingual">Bilingual (Both)</option>
                  <option value="translated-only">Translated Only</option>
                  <option value="original-only">Original Only</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="subtitle-line-order"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Line Order
                </label>
                <select
                  id="subtitle-line-order"
                  data-testid="subtitle-line-order-select"
                  aria-label="Subtitle Line Order"
                  value={subtitleLineOrder}
                  onChange={(e) => {
                    const next = e.target.value as SubtitleLineOrder;
                    setSubtitleLineOrder(next);
                    void saveSettings({ subtitleLineOrder: next });
                  }}
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all"
                >
                  <option value="original-first">Original First (Top)</option>
                  <option value="translated-first">Translated First (Top)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="subtitle-font-size"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Font Size
                </label>
                <select
                  id="subtitle-font-size"
                  data-testid="subtitle-font-size-select"
                  aria-label="Subtitle Font Size"
                  value={subtitleFontSize}
                  onChange={(e) => {
                    const next = e.target.value as SubtitleFontSize;
                    setSubtitleFontSize(next);
                    void saveSettings({ subtitleFontSize: next });
                  }}
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all"
                >
                  <option value="small">Small (14px)</option>
                  <option value="standard">Standard (18px)</option>
                  <option value="large">Large (22px)</option>
                </select>
              </div>
            </div>

            {/* Action Row for Reset Subtitle Position */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-5 border-t border-gray-800/80">
              <p className="text-xs font-sans text-gray-400 max-w-md">
                Reposition subtitles freely by dragging the on-screen pill. Double-click the pill or tap reset below to return to the default bottom docking.
              </p>
              <div className="flex items-center gap-3">
                {resetPositionStatus && (
                  <span className="px-3 py-1 rounded border border-[#00ff88]/60 bg-[#00ff88]/15 text-[#00ff88] font-mono text-xs font-bold shadow-[0_0_10px_rgba(0,255,136,0.3)] animate-in fade-in">
                    {resetPositionStatus}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="reset-subtitle-position-btn"
                  aria-label="Reset Subtitle Position"
                  onClick={handleResetSubtitlePosition}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#00f2fe]/40 hover:border-[#00f2fe] bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 text-[#00f2fe] font-mono text-xs uppercase tracking-wider transition-all duration-150 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Subtitle Position
                </button>
              </div>
            </div>
          </section>

          {/* Section 4: Sub-atomic Cache Vault */}
          <section className="relative rounded-xl border border-[#00ff88]/30 bg-[#0a0e1a]/85 backdrop-blur-xl p-6 shadow-[0_0_24px_rgba(0,255,136,0.08)]">
            <div className="flex items-center justify-between border-b border-[#00ff88]/20 pb-3 mb-6">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-[#00ff88]" />
                <h2 className="text-lg font-mono font-bold tracking-wide text-white">
                  SUB-ATOMIC CACHE VAULT
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30">
                INDEXEDDB CACHE
              </span>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-[#05070e] border border-gray-800">
                  <div className="text-xs font-mono text-gray-400 uppercase">Cached Videos</div>
                  <div
                    data-testid="cache-videos-count"
                    className="text-xl font-mono font-bold text-[#00ff88] mt-1"
                  >
                    {videoCountLabel}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[#05070e] border border-gray-800">
                  <div className="text-xs font-mono text-gray-400 uppercase">Storage Consumed</div>
                  <div
                    data-testid="cache-bytes-count"
                    className="text-xl font-mono font-bold text-[#00f2fe] mt-1"
                  >
                    {totalMB} MB
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                <p className="text-xs font-sans text-gray-400 max-w-md">
                  Purging removes all cached audio segments and translated transcripts from your local IndexedDB storage.
                </p>
                <button
                  type="button"
                  data-testid="purge-cache-btn"
                  onClick={handlePurgeCache}
                  disabled={isPurging}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#ff007a]/50 hover:border-[#ff007a] bg-[#ff007a]/15 hover:bg-[#ff007a]/25 text-[#ff007a] font-mono text-xs uppercase tracking-wider transition-all duration-150 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Purge Local Cache
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};