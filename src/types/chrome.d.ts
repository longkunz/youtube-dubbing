/**
 * Ambient type declarations for Chrome Extension APIs used across the extension.
 */

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void
      ): void | Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>, callback?: () => void): void | Promise<void>;
      clear(callback?: () => void): void | Promise<void>;
    }

    const local: StorageArea;
  }

  namespace runtime {
    const lastError: { message?: string } | undefined;
    function openOptionsPage(callback?: () => void): void | Promise<void>;
    function getURL(path: string): string;
    function sendMessage(
      message: unknown,
      responseCallback?: (response: unknown) => void
    ): void | Promise<unknown>;
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
  }

  namespace action {
    const onClicked: {
      addListener(callback: (tab?: unknown) => void): void;
    };
  }
}