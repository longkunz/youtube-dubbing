/**
 * Sec-MS-GEC token generation for the Edge TTS WebSocket endpoint.
 *
 * Microsoft tightened access to speech.platform.bing.com (see
 * rany2/edge-tts#290): the handshake now requires time-bound `Sec-MS-GEC`
 * + `Sec-MS-GEC-Version` query params, otherwise the server answers 403.
 * This module ports the client-computable part of rany2/edge-tts `drm.py`
 * (no network needed; clock-skew correction against the server Date header
 * is omitted — system clocks are assumed roughly correct):
 *
 *   ticks = (unixNow + 11644473600); ticks -= ticks % 300; ticks *= 1e7
 *   Sec-MS-GEC = SHA256(`${ticks}${TRUSTED_CLIENT_TOKEN}`).hexdigest().upper()
 */

/** Public client token shared by Edge Read Aloud clients. */
export const EDGE_TTS_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

/** GEC version pinned to a Chromium release (mirrors edge-tts constants). */
export const SEC_MS_GEC_VERSION = '1-143.0.3650.75';

const WIN_EPOCH_SECONDS = 11644473600;
const ROUND_WINDOW_SECONDS = 300;

export const EDGE_TTS_WS_BASE_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

/**
 * Build the exact ASCII string that gets SHA-256 hashed.
 * Pure function — extracted for unit testing with fixed timestamps.
 */
export function buildSecMsGecInput(
  nowSeconds: number,
  trustedClientToken: string = EDGE_TTS_TRUSTED_CLIENT_TOKEN
): string {
  // Switch to Windows file time epoch, round down to 5-minute windows,
  // then convert to 100-nanosecond intervals. Mirrors Python float ops
  // in edge-tts drm.py step by step (same IEEE-754 doubles).
  let ticks = nowSeconds + WIN_EPOCH_SECONDS;
  ticks -= ticks % ROUND_WINDOW_SECONDS;
  ticks *= 1e9 / 100;
  return `${ticks.toFixed(0)}${trustedClientToken}`;
}

function toHexUppercase(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/**
 * Generate a fresh Sec-MS-GEC token via WebCrypto (available in MV3
 * service workers, extension pages, and Node 18+ test runners).
 */
export async function generateSecMsGec(
  nowMs: number = Date.now(),
  trustedClientToken: string = EDGE_TTS_TRUSTED_CLIENT_TOKEN
): Promise<string> {
  const subtle = (globalThis as any)?.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle is unavailable — cannot mint Sec-MS-GEC token');
  }
  const input = buildSecMsGecInput(nowMs / 1000, trustedClientToken);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHexUppercase(new Uint8Array(digest));
}

/**
 * Build the full authenticated WebSocket URL for one synthesis connection.
 */
export async function buildEdgeTtsWsUrl(
  connectionId: string,
  options: {
    generateGec?: () => Promise<string> | string;
    version?: string;
  } = {}
): Promise<string> {
  const gec = await (options.generateGec?.() ?? generateSecMsGec());
  const version = options.version ?? SEC_MS_GEC_VERSION;
  return (
    `${EDGE_TTS_WS_BASE_URL}` +
    `?TrustedClientToken=${EDGE_TTS_TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=${version}`
  );
}
