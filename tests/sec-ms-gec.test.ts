import { describe, it, expect } from 'vitest';
import {
  buildSecMsGecInput,
  generateSecMsGec,
  buildEdgeTtsWsUrl,
  EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  SEC_MS_GEC_VERSION,
} from '../src/core/tts/sec-ms-gec';

describe('Sec-MS-GEC token (Edge TTS 403 fix, ported from rany2/edge-tts drm.py)', () => {
  it('builds the exact hash input for a fixed timestamp', () => {
    // nowSeconds=1750000000 → ticks=13394473600 → round down 100 → ×1e7
    expect(buildSecMsGecInput(1750000000)).toBe(
      `133944735000000000${EDGE_TTS_TRUSTED_CLIENT_TOKEN}`
    );
  });

  it('rounds timestamps down to 5-minute windows', () => {
    // +299s stays in the same window, +300s moves to the next one
    expect(buildSecMsGecInput(1750000000 + 199)).toBe(buildSecMsGecInput(1750000000));
    expect(buildSecMsGecInput(1750000000 + 200)).not.toBe(buildSecMsGecInput(1750000000));
  });

  it('generates the known SHA-256 vector (uppercase hex)', async () => {
    // nowMs for unix 1750000000 → input above; digest verified with node:crypto
    const gec = await generateSecMsGec(1750000000 * 1000);
    expect(gec).toBe('81C8AA79A860738D7C6C28578D367A9D88EC6A4F4D98C9FD9F5BC32C4B94CB91');
  });

  it('returns 64-char uppercase hex for the current time', async () => {
    const gec = await generateSecMsGec();
    expect(gec).toMatch(/^[0-9A-F]{64}$/);
  });

  it('builds an authenticated WS URL with ConnectionId, GEC and version', async () => {
    const url = await buildEdgeTtsWsUrl('abc123', {
      generateGec: async () => 'FAKEGEC64CHARS__FAKEGEC64CHARS__FAKEGEC64CHARS__FAKEGEC64',
    });
    expect(url).toContain('synthesize/readaloud/edge/v1');
    expect(url).toContain(`TrustedClientToken=${EDGE_TTS_TRUSTED_CLIENT_TOKEN}`);
    expect(url).toContain('ConnectionId=abc123');
    expect(url).toContain('Sec-MS-GEC=FAKEGEC64CHARS__FAKEGEC64CHARS__FAKEGEC64CHARS__FAKEGEC64');
    expect(url).toContain(`Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`);
  });
});
