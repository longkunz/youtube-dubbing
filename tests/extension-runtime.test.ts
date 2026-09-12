import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getExtensionRuntime, sendExtensionMessage } from '../src/core/extension-runtime';

describe('extension runtime messaging', () => {
  const originalChrome = (globalThis as any).chrome;
  const originalBrowser = (globalThis as any).browser;

  beforeEach(() => {
    delete (globalThis as any).chrome;
    delete (globalThis as any).browser;
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    (globalThis as any).browser = originalBrowser;
  });

  it('returns null when neither chrome nor browser runtime exists', () => {
    expect(getExtensionRuntime()).toBeNull();
  });

  it('resolves chrome.runtime.sendMessage from globalThis even if a free chrome binding is missing', () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome = { runtime: { sendMessage } };
    expect(getExtensionRuntime()?.sendMessage).toBe(sendMessage);
  });

  it('falls back to browser.runtime when chrome is absent', () => {
    const sendMessage = vi.fn();
    (globalThis as any).browser = { runtime: { sendMessage } };
    expect(getExtensionRuntime()?.sendMessage).toBe(sendMessage);
  });

  it('sendExtensionMessage delivers the response via callback', async () => {
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: (_msg: unknown, cb: (res: unknown) => void) => {
          cb({ success: true, segments: [{ id: 's1' }] });
        },
      },
    };
    await expect(
      sendExtensionMessage({ action: 'TRANSLATE_SEGMENTS' }, 1000),
    ).resolves.toEqual({ success: true, segments: [{ id: 's1' }] });
  });
});
