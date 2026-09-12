import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleActionClick } from '@/entrypoints/background';

describe('Background Extension Action & Fallback (Issue #17)', () => {
  let originalChrome: any;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      action: {
        onClicked: {
          addListener: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
      },
      runtime: {
        openOptionsPage: vi.fn(),
        lastError: null,
      },
    };
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it('queries the active tab in currentWindow when action icon is clicked', async () => {
    const querySpy = vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([{ id: 101, url: 'https://www.youtube.com/watch?v=abc' } as any]);
      return Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=abc' } as any]);
    });

    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tabId, _msg, callback) => {
      if (callback) callback({ success: true });
      return Promise.resolve({ success: true });
    });

    await handleActionClick();

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, currentWindow: true }),
      expect.any(Function)
    );
  });

  it('dispatches TOGGLE_COMMAND_CENTER to active tab and succeeds without opening options page', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([{ id: 101, url: 'https://www.youtube.com/watch?v=abc' } as any]);
      return Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=abc' } as any]);
    });

    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tabId, _msg, callback) => {
      if (callback) callback({ success: true });
      return Promise.resolve({ success: true });
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      101,
      { action: 'TOGGLE_COMMAND_CENTER' },
      expect.any(Function)
    );
    expect(openOptionsSpy).not.toHaveBeenCalled();
  });

  it('falls back to openOptionsPage if no active tab is found', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([]);
      return Promise.resolve([]);
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to openOptionsPage if active tab has no tab.id', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([{ url: 'https://www.youtube.com/' } as any]);
      return Promise.resolve([{ url: 'https://www.youtube.com/' } as any]);
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to openOptionsPage when chrome.runtime.lastError occurs (e.g. non-YouTube tab)', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([{ id: 202, url: 'chrome://extensions' } as any]);
      return Promise.resolve([{ id: 202, url: 'chrome://extensions' } as any]);
    });

    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tabId, _msg, callback) => {
      (chrome.runtime as any).lastError = new Error('Could not establish connection. Receiving end does not exist.');
      if (callback) callback(undefined);
      return Promise.resolve(undefined);
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to openOptionsPage when content script responds with { success: false } or empty response', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation((_queryInfo, callback) => {
      if (callback) callback([{ id: 303, url: 'https://www.youtube.com/' } as any]);
      return Promise.resolve([{ id: 303, url: 'https://www.youtube.com/' } as any]);
    });

    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tabId, _msg, callback) => {
      if (callback) callback({ success: false });
      return Promise.resolve({ success: false });
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to openOptionsPage when chrome.tabs.query rejects or throws', async () => {
    vi.spyOn(chrome.tabs, 'query').mockImplementation(() => {
      throw new Error('Tabs query failed');
    });

    const openOptionsSpy = vi.spyOn(chrome.runtime, 'openOptionsPage');

    await handleActionClick();

    expect(openOptionsSpy).toHaveBeenCalledTimes(1);
  });
});
