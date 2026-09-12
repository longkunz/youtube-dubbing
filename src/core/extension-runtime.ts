/**
 * Resolve the extension runtime in isolated content scripts.
 *
 * Always read from `globalThis` — a free `chrome` identifier can be missing
 * after bundling even when the isolated-world API is present.
 */

export type RuntimeSendMessage = (
  message: unknown,
  callback?: (response: unknown) => void,
) => void;

interface ExtensionRuntime {
  sendMessage: RuntimeSendMessage;
  lastError?: { message?: string };
  connect?: (info?: { name?: string }) => { onDisconnect?: { addListener: (fn: () => void) => void } };
  onMessage?: {
    addListener: (
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void
      ) => boolean | void
    ) => void;
  };
}

export function getExtensionRuntime(): ExtensionRuntime | null {
  const g = globalThis as unknown as {
    chrome?: { runtime?: ExtensionRuntime };
    browser?: { runtime?: ExtensionRuntime };
  };
  const runtime = g.chrome?.runtime ?? g.browser?.runtime;
  if (runtime && typeof runtime.sendMessage === 'function') {
    return runtime;
  }
  return null;
}

export function sendExtensionMessage<T>(
  message: unknown,
  timeoutMs: number,
): Promise<T> {
  const runtime = getExtensionRuntime();
  if (!runtime) {
    return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Extension message timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    try {
      runtime.sendMessage(message, (response: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const lastError = runtime.lastError ?? getExtensionRuntime()?.lastError;
        if (lastError?.message) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
