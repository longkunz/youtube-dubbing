import React, { useState, useEffect } from 'react';
import {
  getSettings,
  saveSettings,
  pingGeminiConnection,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from '../../storage/settings';
import { SegmentCache, type StorageUsageStats } from '../../storage/segment-cache';
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
  AlertTriangle,
  Sliders,
  Radio,
  ShieldCheck,
} from 'lucide-react';

export interface OptionsDashboardProps {
  segmentCache?: SegmentCache;
  pingFn?: (apiKey: string) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

export const OptionsDashboard: React.FC<OptionsDashboardProps> = ({
  segmentCache,
  pingFn,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState<'edge-tts' | 'web-speech'>('edge-tts');
  const [ttsPitch, setTtsPitch] = useState('+0Hz');
  const [ttsRate, setTtsRate] = useState('+0%');
  const [enableFallback, setEnableFallback] = useState(true);

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<{
    loading: boolean;
    result?: { ok: boolean; latencyMs: number; error?: string };
  } | null>(null);

  const [storageUsage, setStorageUsage] = useState<StorageUsageStats | null>(null);
  const [isPurging, setIsPurging] = useState(false);

  const cache = segmentCache ?? new SegmentCache();

  useEffect(() => {
    let active = true;

    getSettings().then((saved) => {
      if (!active) return;
      setGeminiApiKey(saved.geminiApiKey || '');
      setGroqApiKey(saved.groqApiKey || '');
      setTtsProvider(saved.ttsProvider || 'edge-tts');
      setTtsPitch(saved.ttsPitch || '+0Hz');
      setTtsRate(saved.ttsRate || '+0%');
      setEnableFallback(saved.enableFallback ?? true);
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

  const handleSaveCredentials = async () => {
    await saveSettings({
      geminiApiKey,
      groqApiKey,
      ttsProvider,
      ttsPitch,
      ttsRate,
      enableFallback,
    });
    setSaveStatus('Credentials saved');
    setTimeout(() => {
      setSaveStatus(null);
    }, 3500);
  };

  const handlePing = async () => {
    setPingStatus({ loading: true });
    const pingExecutor = pingFn ?? pingGeminiConnection;
    try {
      const res = await pingExecutor(geminiApiKey);
      setPingStatus({ loading: false, result: res });
    } catch (err) {
      setPingStatus({
        loading: false,
        result: {
          ok: false,
          latencyMs: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const handlePurgeCache = async () => {
    setIsPurging(true);
    try {
      await cache.purgeAll();
      const updated = await cache.getStorageUsage();
      setStorageUsage(updated);
    } finally {
      setIsPurging(false);
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
              Operations Deck // Neural Dubbing & Sub-Atomic Cache Subsystems
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
                BYOK CREDENTIALS
              </span>
            </div>

            <div className="space-y-5">
              {/* Gemini API Key */}
              <div>
                <label
                  htmlFor="gemini-key"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Gemini API Key (Primary Dubbing Engine)
                </label>
                <div className="relative flex items-center">
                  <input
                    id="gemini-key"
                    data-testid="gemini-key-input"
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all pr-10"
                  />
                  <button
                    type="button"
                    aria-label="Toggle Gemini API Key visibility"
                    onClick={() => setShowGeminiKey((prev) => !prev)}
                    className="absolute right-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer p-1"
                  >
                    {showGeminiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Groq / OpenAI API Key */}
              <div>
                <label
                  htmlFor="groq-key"
                  className="block text-xs font-mono text-gray-300 uppercase tracking-wider mb-2"
                >
                  Groq / OpenAI API Key (Whisper STT Fallback)
                </label>
                <div className="relative flex items-center">
                  <input
                    id="groq-key"
                    data-testid="groq-key-input"
                    type={showGroqKey ? 'text' : 'password'}
                    value={groqApiKey}
                    onChange={(e) => setGroqApiKey(e.target.value)}
                    placeholder="gsk_... or sk-..."
                    className="w-full bg-[#05070e] border border-gray-700 focus:border-[#00f2fe] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#00f2fe] transition-all pr-10"
                  />
                  <button
                    type="button"
                    aria-label="Toggle Groq API Key visibility"
                    onClick={() => setShowGroqKey((prev) => !prev)}
                    className="absolute right-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer p-1"
                  >
                    {showGroqKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Action Buttons & Ping Badge */}
              <div className="pt-3 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveCredentials}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#00f2fe]/80 to-[#7928ca]/80 hover:from-[#00f2fe] hover:to-[#7928ca] text-white font-mono text-xs font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Credentials
                  </button>

                  <button
                    type="button"
                    onClick={handlePing}
                    disabled={pingStatus?.loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#00f2fe]/40 hover:border-[#00f2fe] bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 text-[#00f2fe] font-mono text-xs uppercase tracking-wider transition-all duration-150 cursor-pointer disabled:opacity-50"
                  >
                    <Activity className={`w-3.5 h-3.5 ${pingStatus?.loading ? 'animate-spin' : ''}`} />
                    Ping Connection
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
                  aria-label="Select TTS Engine Provider"
                  value={ttsProvider}
                  onChange={(e) =>
                    setTtsProvider(e.target.value as 'edge-tts' | 'web-speech')
                  }
                  className="w-full bg-[#05070e] border border-gray-700 focus:border-[#ff007a] rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#ff007a] transition-all"
                >
                  <option value="edge-tts">Edge Neural TTS (Zero-Config Default)</option>
                  <option value="web-speech">Web Speech API (Local Fallback)</option>
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
                    type="text"
                    value={ttsRate}
                    onChange={(e) => setTtsRate(e.target.value)}
                    placeholder="+0%"
                    className="w-full bg-[#05070e] border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#ff007a] focus:outline-none"
                  />
                </div>
              </div>

              {/* Fallback Checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  id="enable-fallback"
                  type="checkbox"
                  checked={enableFallback}
                  onChange={(e) => setEnableFallback(e.target.checked)}
                  className="rounded border-gray-700 text-[#00f2fe] focus:ring-[#00f2fe] bg-[#05070e]"
                />
                <label
                  htmlFor="enable-fallback"
                  className="text-xs font-mono text-gray-300 cursor-pointer select-none"
                >
                  Enable Web Speech API Fallback upon Edge-TTS Failure
                </label>
              </div>
            </div>
          </section>

          {/* Section 3: Sub-atomic Cache Vault */}
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
                  <div className="text-xl font-mono font-bold text-[#00ff88] mt-1">
                    {videoCountLabel}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[#05070e] border border-gray-800">
                  <div className="text-xs font-mono text-gray-400 uppercase">Storage Consumed</div>
                  <div className="text-xl font-mono font-bold text-[#00f2fe] mt-1">
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