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
    const onConnect: {
      addListener(callback: (port: { name?: string }) => void): void;
    };
    function connect(info?: { name?: string }): {
      onDisconnect?: { addListener: (fn: () => void) => void };
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      active?: boolean;
      windowId?: number;
      [key: string]: unknown;
    }
    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean; [key: string]: unknown },
      callback?: (result: Tab[]) => void
    ): Promise<Tab[]> | void;
    function sendMessage(
      tabId: number,
      message: unknown,
      responseCallback?: (response: unknown) => void
    ): Promise<unknown> | void;
  }

  namespace action {
    const onClicked: {
      addListener(callback: (tab?: chrome.tabs.Tab) => void): void;
    };
  }
}